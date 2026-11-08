import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { loadGames, type GameSummary } from './games'
import { messageOf } from './errors'
import { meterStates, type MeterState } from './stamina'
import { dailyPeriod, formatWhen, isDoneIn, taskPeriod } from './time'

type Task = GameSummary['tasks'][number]
export type EventRow = { id: string; game_id: string; name: string; ends_at: string }

export type TodayData = {
  games: GameSummary[]
  completions: Map<string, string[]> // task id → completed_at timestamps
  events: EventRow[]
}

// Loads games (syncing outdated presets), recent completions and upcoming events.
async function loadToday(): Promise<TodayData> {
  const since = new Date(Date.now() - 62 * 86_400_000).toISOString()
  const [games, completionsRes, eventsRes] = await Promise.all([
    loadGames(),
    supabase.from('completions').select('task_id, completed_at').gte('completed_at', since),
    supabase.from('events').select('id, game_id, name, ends_at').gte('ends_at', new Date().toISOString()).order('ends_at'),
  ])
  if (completionsRes.error) throw completionsRes.error
  if (eventsRes.error) throw eventsRes.error

  const completions = new Map<string, string[]>()
  for (const c of completionsRes.data) {
    const list = completions.get(c.task_id) ?? []
    list.push(c.completed_at)
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

  return { data, error, loading: !data && !error, refresh }
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
const visible = (t: Task) => !t.archived && !t.hidden

// Optional tasks (subscriptions, mail) don't count towards "dailies left".
function counted(t: Task) {
  return visible(t) && !t.optional
}

export function buildToday(data: TodayData, now: Date) {
  const horizon = now.getTime() + DAY
  const attention: AttentionItem[] = []
  const cards: GameCard[] = []

  for (const game of data.games) {
    const presetId = game.preset_id ?? game.id
    const clock = { timezone: game.timezone, daily_reset_time: game.daily_reset_time, weekly_reset_day: game.weekly_reset_day }
    const day = dailyPeriod(clock, now)
    const doneFor = (t: Task) => {
      const period = taskPeriod(t, clock, now)
      return period ? isDoneIn(period, data.completions.get(t.id) ?? []) : false
    }

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
    for (const t of game.tasks.filter((x) => x.category === 'endgame' && visible(x))) {
      const period = taskPeriod(t, clock, now)
      if (!period?.end || doneFor(t)) continue
      const at = period.end
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