import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { loadGames, type GameSummary } from './games'
import { messageOf } from './errors'
import { meterStates, type MeterState } from './stamina'
import { countIn, dailyPeriod, formatWhen, taskPeriod, weeklyPeriod, type ResetClock } from './time'

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
export function taskProgress(task: Task, data: TodayData, clock: ResetClock, now: Date) {
  const ats = (data.completions.get(task.id) ?? []).map((c) => c.at)
  const counted = task.weekly_target != null
  const period = counted ? weeklyPeriod(clock, now) : taskPeriod(task, clock, now)
  const count = period ? countIn(period, ats) : 0
  const target = task.weekly_target ?? 1
  const done = count >= target
  const today = counted && task.frequency === 'daily' ? countIn(dailyPeriod(clock, now), ats) > 0 : false
  // "done for now": hidden in What's left, counted as done in the group header
  return { period, count, target, done, today, doneForNow: done || today }
}

// Loads games (syncing outdated presets), recent completions and upcoming events.
async function loadToday(): Promise<TodayData> {
  const since = new Date(Date.now() - 62 * 86_400_000).toISOString()
  const [games, completionsRes, eventsRes] = await Promise.all([
    loadGames(),
    supabase.from('completions').select('id, task_id, completed_at').gte('completed_at', since).order('completed_at'),
    supabase.from('events').select('id, game_id, name, ends_at').gte('ends_at', new Date().toISOString()).order('ends_at'),
  ])
  if (completionsRes.error) throw completionsRes.error
  if (eventsRes.error) throw eventsRes.error

  const completions = new Map<string, Completion[]>()
  for (const c of completionsRes.data) {
    const list = completions.get(c.task_id) ?? []
    list.push({ id: c.id, at: c.completed_at })
    completions.set(c.task_id, list)
  }
  return { games, completions, events: eventsRes.data }
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

  return { data, error, loading: !data && !error, refresh, addCompletion, removeCompletions }
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
      if (!progress.period?.end || progress.done) continue
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

  attention.sort((a, b) => a.at.getTime() - b.at.getTime())
  return { attention, cards }
}