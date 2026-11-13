import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { loadGames, type GameSummary } from './games'
import { messageOf } from './errors'
import { meterStates, type MeterState } from './stamina'
import { dailyPeriod, formatWhen, type ResetClock } from './time'
import { progress } from '../../supabase/functions/_shared/progress.ts'

export type Game = GameSummary
export type Task = GameSummary['tasks'][number]
export type EventRow = { id: string; game_id: string; name: string; ends_at: string }
export type Completion = { id: string; at: string }

export type TodayData = {
  games: GameSummary[]
  completions: Map<string, Completion[]> // task id → completions, oldest first
  events: EventRow[]
}

export const clockOf = (game: Game): ResetClock => ({
  timezone: game.timezone,
  daily_reset_time: game.daily_reset_time,
  weekly_reset_day: game.weekly_reset_day,
})

// How many times a task was ticked in its current period, and whether that counts as done.
// Tasks with a weekly target (e.g. "5 days a week") count across the week; a daily one can be ticked once a day.
// Uses the same rule as the reminder job (supabase/functions/_shared/progress.ts).
// "doneForNow" is hidden in What's left and counted as done in the group header.
export function taskProgress(task: Task, data: TodayData, clock: ResetClock, now: Date) {
  return progress(task, (data.completions.get(task.id) ?? []).map((c) => c.at), clock, now)
}

// Ids of the task's completions in its current period (what an untick removes)
export function periodCompletionIds(task: Task, data: TodayData, clock: ResetClock, now: Date): string[] {
  const p = taskProgress(task, data, clock, now).period
  if (!p) return []
  const start = p.start.getTime()
  const end = p.end ? p.end.getTime() : Infinity
  return (data.completions.get(task.id) ?? [])
    .filter((c) => {
      const at = new Date(c.at).getTime()
      return at >= start && at < end
    })
    .map((c) => c.id)
}

// What "All done" ticks: the dailies counted on Today (visible, not optional) that aren't done yet.
// Tasks with a weekly target (+1 once a day) are left for you to count yourself.
export function dailiesLeft(game: Game, data: TodayData, now: Date): Task[] {
  const clock = clockOf(game)
  return game.tasks.filter(
    (t) =>
      t.frequency === 'daily' && t.category !== 'endgame' && !t.archived && !t.hidden && !t.optional && t.weekly_target == null &&
      !taskProgress(t, data, clock, now).doneForNow,
  )
}

// Loads games (syncing outdated presets), recent completions and upcoming events.
async function loadToday(): Promise<TodayData> {
  const since = new Date(Date.now() - 62 * 86_400_000).toISOString()
  const [games, completionsRes, eventsRes] = await Promise.all([
    loadGames(),
    supabase.from('completions').select('id, task_id, completed_at').gte('completed_at', since).order('completed_at'),
    // The view already leaves out hidden events and adds the shared catalog events for your games
    supabase.from('user_events').select('id, game_id, name, starts_at, ends_at').is('completed_at', null).gte('ends_at', new Date().toISOString()).order('ends_at').order('name'),
  ])
  if (completionsRes.error) throw completionsRes.error
  if (eventsRes.error) throw eventsRes.error

  const completions = new Map<string, Completion[]>()
  for (const c of completionsRes.data) {
    const list = completions.get(c.task_id) ?? []
    list.push({ id: c.id, at: c.completed_at })
    completions.set(c.task_id, list)
  }
  // Only events that are running now: upcoming and finished ones live on the Events page
  const rows = eventsRes.data as unknown as (EventRow & { starts_at: string | null })[]
  const started = rows.filter((e) => !e.starts_at || new Date(e.starts_at) <= new Date())
  return { games, completions, events: started }
}

export function useTodayData() {
  const [data, setData] = useState<TodayData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadToday()
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageOf(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      setData(await loadToday())
      setError(null)
    } catch (err) {
      setError(messageOf(err))
    }
  }, [])

  // Change the local copy right away so ticks feel instant; the server call follows.
  const patchCompletions = useCallback((taskId: string, change: (list: Completion[]) => Completion[]) => {
    setData((d) => {
      if (!d) return d
      const completions = new Map(d.completions)
      completions.set(taskId, change(d.completions.get(taskId) ?? []))
      return { ...d, completions }
    })
  }, [])

  // Adds one completion for the task's current period (a tick, or +1 on a weekly target).
  const addCompletion = useCallback(
    async (taskId: string, periodStart: Date) => {
      const tempId = `temp-${Date.now()}`
      patchCompletions(taskId, (list) => [...list, { id: tempId, at: new Date().toISOString() }])
      try {
        const { data: session } = await supabase.auth.getSession()
        const userId = session.session?.user.id
        if (!userId) throw new Error('Signed out. Please sign in again.')
        const { data: row, error: err } = await supabase
          .from('completions')
          .insert({ task_id: taskId, user_id: userId, period_start: periodStart.toISOString(), amount: 1 })
          .select('id, completed_at')
          .single()
        if (err) throw err
        patchCompletions(taskId, (list) => list.map((c) => (c.id === tempId ? { id: row.id, at: row.completed_at } : c)))
      } catch (err) {
        setError(messageOf(err))
        await refresh()
      }
    },
    [patchCompletions, refresh],
  )

  // Removes completions by id (untick removes all in the period; −1 removes the newest).
  const removeCompletions = useCallback(
    async (taskId: string, ids: string[]) => {
      if (ids.length === 0) return
      patchCompletions(taskId, (list) => list.filter((c) => !ids.includes(c.id)))
      try {
        const { error: err } = await supabase.from('completions').delete().in('id', ids)
        if (err) throw err
      } catch (err) {
        setError(messageOf(err))
        await refresh()
      }
    },
    [patchCompletions, refresh],
  )

  // Saves what the game shows right now. Overflow meters (Crystals) are snapshotted first,
  // because they stop filling once their parent drops below cap.
  const setMeterValue = useCallback(
    async (game: Game, meterId: string, value: number) => {
      const now = new Date()
      const iso = now.toISOString()
      const states = meterStates(game.stamina_meters, now)
      const children = game.stamina_meters.filter((m) => m.fills_when_full_of === meterId)
      const updates = [
        ...children.map((c) => ({ id: c.id, current_value: states.find((s) => s.id === c.id)?.value ?? c.current_value })),
        { id: meterId, current_value: Math.max(0, Math.round(value)) },
      ]
      setData((d) =>
        d && {
          ...d,
          games: d.games.map((g) =>
            g.id !== game.id
              ? g
              : {
                  ...g,
                  stamina_meters: g.stamina_meters.map((m) => {
                    const u = updates.find((x) => x.id === m.id)
                    return u ? { ...m, current_value: u.current_value, value_recorded_at: iso } : m
                  }),
                },
          ),
        },
      )
      try {
        for (const u of updates) {
          const { error: err } = await supabase
            .from('stamina_meters')
            .update({ current_value: u.current_value, value_recorded_at: iso })
            .eq('id', u.id)
          if (err) throw err
        }
      } catch (err) {
        setError(messageOf(err))
        await refresh()
      }
    },
    [refresh],
  )

  return { data, error, loading: !data && !error, refresh, addCompletion, removeCompletions, setMeterValue }
}

// ---- What Today shows ----

export type AttentionItem = {
  key: string
  presetId: string
  gameName: string
  title: string
  at: Date // when it happens (now for things already full)
  urgent: boolean
}

export type GameCard = {
  id: string
  presetId: string
  name: string
  resetAt: Date
  dailyDone: number
  dailyTotal: number
  meter: MeterState | null
  note: { text: string; at: Date | null; soon: boolean } | null
}

const DAY = 86_400_000
export const isVisible = (t: Task) => !t.archived && !t.hidden

// Optional tasks (subscriptions, mail) don't count towards "dailies left".
const counted = (t: Task) => isVisible(t) && !t.optional

export function buildToday(data: TodayData, now: Date) {
  const horizon = now.getTime() + DAY
  const attention: AttentionItem[] = []
  const cards: GameCard[] = []

  for (const game of data.games) {
    const presetId = game.preset_id ?? game.id
    const clock = clockOf(game)
    const day = dailyPeriod(clock, now)
    const doneFor = (t: Task) => taskProgress(t, data, clock, now).done

    // Dailies
    const dailies = game.tasks.filter((t) => t.frequency === 'daily' && counted(t))
    const dailyDone = dailies.filter(doneFor).length
    const left = dailies.length - dailyDone
    if (left > 0) {
      attention.push({
        key: `${game.id}-dailies`, presetId, gameName: game.name,
        title: `${left} ${left === 1 ? 'daily' : 'dailies'} left`, at: day.end!, urgent: false,
      })
    }

    // Stamina: full, or within 10% of cap
    const meters = meterStates(game.stamina_meters, now)
    for (const m of meters) {
      if (m.full) {
        attention.push({ key: m.id, presetId, gameName: game.name, title: `${m.name} ${m.name.endsWith('s') ? 'are' : 'is'} full`, at: now, urgent: true })
      } else if (m.value >= m.cap * 0.9 && m.fullAt && m.fullAt.getTime() <= horizon) {
        attention.push({ key: m.id, presetId, gameName: game.name, title: `${m.name} caps at ${formatWhen(m.fullAt, now)}`, at: m.fullAt, urgent: false })
      }
    }

    // Endgame not cleared and ending within 24 h; also the soonest one for the card
    let soonest: GameCard['note'] = null
    for (const t of game.tasks.filter((x) => x.category === 'endgame' && isVisible(x))) {
      const progress = taskProgress(t, data, clock, now)
      if (!progress.period?.end || progress.done || progress.period.start > now) continue
      const at = progress.period.end
      if (at.getTime() <= horizon) {
        attention.push({ key: t.id, presetId, gameName: game.name, title: `${t.title} not cleared`, at, urgent: true })
      }
      if (!soonest || (soonest.at && at < soonest.at)) {
        soonest = { text: `${t.title} not cleared`, at, soon: at.getTime() - now.getTime() < 3 * DAY }
      }
    }

    // Events ending within 24 h
    for (const ev of data.events.filter((e) => e.game_id === game.id)) {
      const at = new Date(ev.ends_at)
      if (at.getTime() <= horizon) {
        attention.push({ key: ev.id, presetId, gameName: game.name, title: `${ev.name} ends`, at, urgent: true })
      }
    }

    cards.push({
      id: game.id, presetId, name: game.name, resetAt: day.end!,
      dailyDone, dailyTotal: dailies.length,
      meter: meters.find((m) => !m.isOverflow) ?? null,
      note: soonest,
    })
  }

  attention.sort((a, b) => a.at.getTime() - b.at.getTime() || a.title.localeCompare(b.title))
  return { attention, cards }
}
