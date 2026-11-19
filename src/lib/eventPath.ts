// EVT-13: the Events page's "path" timeline. Turns events and endgame resets into stops on a path,
// one stop per day that has something on it: an event starting, an event ending, or an endgame mode
// resetting. Days are your own local days (the times shown are your local times, like everywhere else).
// Pure logic, tested in eventPath.test.ts; EventPath.tsx draws it.
import type { GameEvent } from './events'
import { taskPeriod } from './time'
import { clockOf, isVisible, type Game } from './today'

const DAY_MS = 86_400_000
export const PATH_DAYS = 42 // six weeks ahead, like the bars
const SOON_MS = 3 * DAY_MS

export type PathItem = {
  key: string
  kind: 'end' | 'start' | 'cycle'
  at: Date
  label: string
  game: Game
  event?: GameEvent // events open when clicked; endgame resets have none
  soon: boolean // an event ending within three days
}

export type PathDay = { day: Date; items: PathItem[] }

/** Local midnight of a moment's day. */
export function dayOf(at: Date) {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate())
}

/** Whole local days from one midnight to another (safe across daylight saving). */
export function daysBetween(a: Date, b: Date) {
  return Math.round((dayOf(b).getTime() - dayOf(a).getTime()) / DAY_MS)
}

const ORDER = { end: 0, start: 1, cycle: 2 } as const

/**
 * Everything on the path from now until `days` days ahead, grouped by day, soonest first.
 * Events: a stop where they start (if still ahead) and where they end. Endgame modes: each reset in the
 * window (a two-week mode can reset twice). Done events are left out by the caller (open events only).
 */
export function buildPath(games: Game[], events: GameEvent[], now: Date, days = PATH_DAYS): PathDay[] {
  const until = dayOf(now).getTime() + (days + 1) * DAY_MS
  const inWindow = (t: number) => t > now.getTime() && t < until
  const items: PathItem[] = []

  for (const e of events) {
    const game = games.find((g) => g.id === e.game_id)
    if (!game) continue
    const end = new Date(e.ends_at)
    if (e.starts_at && inWindow(new Date(e.starts_at).getTime())) {
      items.push({ key: `${e.id}:start`, kind: 'start', at: new Date(e.starts_at), label: e.name, game, event: e, soon: false })
    }
    if (inWindow(end.getTime())) {
      items.push({ key: `${e.id}:end`, kind: 'end', at: end, label: e.name, game, event: e, soon: end.getTime() - now.getTime() <= SOON_MS })
    }
  }

  for (const game of games) {
    for (const t of game.tasks.filter((x) => x.category === 'endgame' && isVisible(x))) {
      let at = now
      // Each reset in the window; a guard in case a rule never moves forward
      for (let i = 0; i < 8; i++) {
        const end = taskPeriod(t, clockOf(game), at)?.end
        if (!end || end.getTime() <= at.getTime() || !inWindow(end.getTime())) break
        items.push({ key: `${t.id}:${end.getTime()}`, kind: 'cycle', at: end, label: t.title, game, soon: false })
        at = new Date(end.getTime() + 60_000)
      }
    }
  }

  const byDay = new Map<number, PathItem[]>()
  for (const item of items) {
    const key = dayOf(item.at).getTime()
    byDay.set(key, [...(byDay.get(key) ?? []), item])
  }
  return [...byDay]
    .sort(([a], [b]) => a - b)
    .map(([day, list]) => ({
      day: new Date(day),
      items: list.sort((a, b) => a.at.getTime() - b.at.getTime() || ORDER[a.kind] - ORDER[b.kind] || a.label.localeCompare(b.label)),
    }))
}

/** The gap above a stop, in pixels: further apart in time means further apart on the path, within limits. */
export function stopGap(daysSincePrevious: number, phone: boolean) {
  const [perDay, min, max] = phone ? [9, 26, 70] : [13, 30, 96]
  return Math.max(min, Math.min(max, daysSincePrevious * perDay))
}
