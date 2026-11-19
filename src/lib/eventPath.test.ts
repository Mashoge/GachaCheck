import { describe, expect, it } from 'vitest'
import { buildPath, daysBetween, stopGap } from './eventPath'
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

  it('leaves out what already ended and what is more than six weeks away', () => {
    const path = buildPath(games, [event('gone', 'gi', at(19, 9)), event('far', 'gi', new Date(2027, 1, 1))], now)
    expect(path).toEqual([])
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
