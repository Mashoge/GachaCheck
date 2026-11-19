import { describe, expect, it } from 'vitest'
import { buildPath, daysBetween, pathLean, stopGap } from './eventPath'
import type { GameEvent } from './events'
import type { Game, Task } from './today'

// Local-time dates, so day grouping means the same in every time zone
const at = (d: number, h = 12, m = 0) => new Date(2026, 10, d, h, m)
const now = at(19, 18)

function game(id: string, tasks: Task[] = []): Game {
  return { id, name: id, preset_id: id, timezone: 'Etc/GMT-8', daily_reset_time: '04:00', weekly_reset_day: 1, tasks, stamina_meters: [] } as unknown as Game
}

function endgame(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, title: id, frequency: 'interval', category: 'endgame', hidden: false, optional: false, archived: false,
    weekly_target: null, monthly_day: null, cycle_anchor: '2026-11-16', cycle_days: 14, cycle_ends_at: null, ...overrides,
  } as Task
}

function event(id: string, game_id: string, ends: Date, starts: Date | null = null): GameEvent {
  return {
    id, game_id, name: id, starts_at: starts?.toISOString() ?? null, ends_at: ends.toISOString(), note: null, remind: true,
    completed_at: null, source: 'manual', origin: 'own', kind: 'event', official_url: null, catalog_event_id: null, picture_path: null,
  }
}

describe('buildPath', () => {
  const games = [game('gi'), game('ww')]

  it('puts each event on the day it ends, grouped by day and soonest first', () => {
    const path = buildPath(games, [event('b', 'ww', at(30, 3, 59)), event('a', 'gi', at(23, 4, 59)), event('c', 'gi', at(30, 1))], now)
    expect(path.map((d) => d.day.getDate())).toEqual([23, 30])
    expect(path[1].items.map((i) => i.label)).toEqual(['c', 'b']) // by time within the day
    expect(path[0].items[0]).toMatchObject({ kind: 'end', label: 'a' })
  })

  it('adds a start stop only for events that have not started yet', () => {
    const path = buildPath(games, [event('later', 'gi', at(28), at(24)), event('running', 'gi', at(29), at(10))], now)
    const kinds = path.flatMap((d) => d.items.map((i) => `${i.label}:${i.kind}`))
    expect(kinds).toEqual(['later:start', 'later:end', 'running:end'])
  })

  it('marks events ending within three days as soon', () => {
    const path = buildPath(games, [event('close', 'gi', at(22, 17)), event('far', 'gi', at(25))], now)
    expect(path.flatMap((d) => d.items).map((i) => `${i.label}:${i.soon}`)).toEqual(['close:true', 'far:false'])
  })

  it('leaves out what already ended, but keeps events ending months away', () => {
    const path = buildPath(games, [event('gone', 'gi', at(19, 9)), event('far', 'gi', new Date(2027, 1, 1))], now)
    expect(path.flatMap((d) => d.items.map((i) => i.label))).toEqual(['far'])
  })

  it('keeps a finished event, marked done and never soon', () => {
    const finished = { ...event('done', 'gi', at(20)), completed_at: at(19, 10).toISOString() }
    expect(buildPath(games, [finished], now)[0].items[0]).toMatchObject({ label: 'done', done: true, soon: false })
  })

  it("puts a day's endgame resets after its events", () => {
    // The reset is 4:00 server time (UTC+8); the event ends an hour later, the same local day in any time zone
    const reset = endgame('abyss', { frequency: 'dated', cycle_ends_at: '2026-11-30T04:00' } as Partial<Task>)
    const path = buildPath([game('gi', [reset])], [event('ev', 'gi', new Date(Date.UTC(2026, 10, 29, 21)))], now)
    expect(path[0].items.map((i) => i.label)).toEqual(['ev', 'abyss'])
  })

  it('skips events of games not shown', () => {
    expect(buildPath([game('gi')], [event('x', 'ww', at(25))], now)).toEqual([])
  })

  it('lists every endgame reset in the window, and none for hidden modes', () => {
    const path = buildPath([game('gi', [endgame('abyss'), endgame('hidden', { hidden: true })])], [], now)
    const resets = path.flatMap((d) => d.items)
    expect(resets.every((i) => i.kind === 'cycle' && i.label === 'abyss')).toBe(true)
    expect(resets.length).toBe(3) // a two-week mode resets three times in six weeks
    const gaps = resets.slice(1).map((r, i) => Math.round((r.at.getTime() - resets[i].at.getTime()) / 86_400_000))
    expect(gaps).toEqual([14, 14])
  })
})

describe('path lean', () => {
  it('leans fully while the drift stays small', () => {
    expect(pathLean(300, 8, 64)).toMatchObject({ drift: 42, spine: 8, chip: 0 })
  })

  it('holds a tall path to the drift limit, the chips making up the rest of the slant', () => {
    const lean = pathLean(2000, 8, 64)
    expect(lean.drift).toBe(64)
    expect(lean.spine).toBeCloseTo(1.833, 2)
    // Spine and chips together still make the full 8°
    expect(Math.tan((lean.spine * Math.PI) / 180) + Math.tan((lean.chip * Math.PI) / 180)).toBeCloseTo(Math.tan((8 * Math.PI) / 180), 4)
  })
})

describe('path spacing', () => {
  it('counts whole local days', () => {
    expect(daysBetween(at(19, 23), at(20, 1))).toBe(1)
    expect(daysBetween(at(19, 1), at(19, 23))).toBe(0)
  })

  it('spaces stops by time, within limits', () => {
    expect(stopGap(1, false)).toBe(30)
    expect(stopGap(4, false)).toBe(52)
    expect(stopGap(30, false)).toBe(96)
    expect(stopGap(30, true)).toBe(70)
  })
})
