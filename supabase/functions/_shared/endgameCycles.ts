// EVT-10: endgame cycle dates from the shared catalog (e.g. WuWa Endstate Matrix, read from the official
// Patch Notes by the collector) go onto each player's matching task. Pure logic: no database here.
//
// A "dated" endgame task holds one cycle: its end date (tasks.cycle_ends_at, in the game's server time)
// and the day it started (cycle_anchor). So a running cycle is never changed: moving its end would merge
// two cycles, and a clear from this cycle would also count for the next. A date is filled in only when the
// task has none, or its end has passed. Then the next cycle to end is used, starting where the old one
// ended. A date the player set by hand is left alone until it passes, the same as EVT-8 never replaces a
// later date with an earlier one.

import { serverMinute } from './genshinFeed.ts'

/** A confirmed endgame cycle from catalog_events (kind = 'endgame_cycle'). Times as the publisher printed them. */
export type CatalogCycle = {
  game: string
  server_scope: string
  task_preset_key: string | null
  ends_local: string
  time_basis: string // 'server_local' | 'fixed_offset'
  utc_offset_minutes: number | null
}

export type CycleTask = {
  id: string
  preset_key?: string | null
  category: string
  frequency: string
  cycle_ends_at: string | null
}

export type CycleGame = {
  id: string
  preset_id: string | null
  server: string | null
  timezone: string
  tasks: CycleTask[]
}

export type CycleUpdate = {
  gameId: string
  taskId: string
  presetKey: string
  cycle_ends_at: string // 'YYYY-MM-DDTHH:MM' in the game's server time, like dates set in the app
  cycle_anchor: string | null // the day the new cycle starts (where the old one ended); null = leave as is
}

const minute = (v: string) => v.replace(' ', 'T').slice(0, 16)
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/

/** A cycle's end as the game's server clock shows it. Fixed-offset times (e.g. "UTC+8") are converted. */
export function cycleEndOnServer(cycle: CatalogCycle, timezone: string): string | null {
  const m = LOCAL.exec(cycle.ends_local)
  if (!m) return null
  if (cycle.time_basis === 'fixed_offset') {
    if (cycle.utc_offset_minutes == null) return null
    const instant = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - cycle.utc_offset_minutes * 60_000
    return serverMinute(new Date(instant), timezone)
  }
  return minute(cycle.ends_local) // already on each server's own clock
}

export function endgameCycleUpdates(cycles: CatalogCycle[], games: CycleGame[], now: Date): CycleUpdate[] {
  const out: CycleUpdate[] = []
  for (const game of games) {
    const nowLocal = serverMinute(now, game.timezone)
    for (const task of game.tasks) {
      if (task.category !== 'endgame' || task.frequency !== 'dated' || !task.preset_key) continue
      const current = task.cycle_ends_at ? minute(task.cycle_ends_at) : null
      if (current && current > nowLocal) continue // a cycle is running: never change it mid-cycle

      const next = cycles
        .filter((c) => c.game === game.preset_id && c.task_preset_key === task.preset_key)
        .filter((c) => c.server_scope === 'all' || c.server_scope === game.server)
        .map((c) => cycleEndOnServer(c, game.timezone))
        .filter((end): end is string => !!end && end > nowLocal && (!current || end > current))
        .sort()[0] // the next cycle to end, not a later one
      if (!next) continue

      out.push({
        gameId: game.id,
        taskId: task.id,
        presetKey: task.preset_key,
        cycle_ends_at: next,
        cycle_anchor: current ? current.slice(0, 10) : null,
      })
    }
  }
  return out
}
