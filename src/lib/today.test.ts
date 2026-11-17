import { describe, expect, it } from 'vitest'
import { buildToday, isSkippedNow, type Game, type Task, type TodayData } from './today'

const now = new Date('2026-11-16T12:00:00+08:00')
const completedAt = '2026-11-16T08:00:00+08:00'

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    frequency: 'daily',
    category: 'routine',
    hidden: false,
    optional: false,
    archived: false,
    weekly_target: null,
    monthly_day: null,
    cycle_anchor: null,
    cycle_days: null,
    cycle_ends_at: null,
    ...overrides,
  } as Task
}

function game(id: string, tasks: Task[]): Game {
  return {
    id,
    name: id,
    preset_id: id,
    timezone: 'Etc/GMT-8',
    daily_reset_time: '04:00',
    weekly_reset_day: 1,
    tasks,
    stamina_meters: [],
  } as unknown as Game
}

describe('buildToday overall daily progress', () => {
  it('sums the same visible, non-optional daily tasks used by each game card', () => {
    const games = [
      game('game-a', [
        task('a-done'),
        task('a-open'),
        task('a-hidden', { hidden: true }),
        task('a-optional', { optional: true }),
        task('a-archived', { archived: true }),
        task('a-weekly', { frequency: 'weekly' }),
        task('a-goal', { frequency: 'none', category: 'goal' }),
      ]),
      game('game-b', [task('b-done')]),
    ]
    const data: TodayData = {
      games,
      completions: new Map([
        ['a-done', [{ id: 'completion-a', at: completedAt }]],
        ['b-done', [{ id: 'completion-b', at: completedAt }]],
      ]),
      events: [],
    }

    const today = buildToday(data, now)

    expect(today.cards.map(({ dailyDone, dailyTotal }) => ({ dailyDone, dailyTotal }))).toEqual([
      { dailyDone: 1, dailyTotal: 2 },
      { dailyDone: 1, dailyTotal: 1 },
    ])
    expect(today.dailyProgress).toEqual({ done: 2, total: 3 })
  })

  it('returns zero progress when there are no games', () => {
    const today = buildToday({ games: [], completions: new Map(), events: [] }, now)
    expect(today.dailyProgress).toEqual({ done: 0, total: 0 })
  })
})

describe('buildToday stamina above the cap (STA-1)', () => {
  const withResin = (current_value: number) => ({
    ...game('genshin', []),
    stamina_meters: [{
      id: 'resin', name: 'Original Resin', cap: 200, minutes_per_point: 8, fills_when_full_of: null,
      current_value, value_recorded_at: '2026-11-16T10:00:00+08:00',
    }],
  }) as unknown as Game
  const titles = (current: number) =>
    buildToday({ games: [withResin(current)], completions: new Map(), events: [] }, now).attention.map((a) => a.title)

  it('says how far above the cap a refill took it', () => {
    expect(titles(260)).toContain('Original Resin is above cap (+60)')
  })

  it('still says "full" when it is exactly at the cap', () => {
    expect(titles(200)).toContain('Original Resin is full')
  })
})

describe('skip a game for today (TOD-7)', () => {
  const resting = (until: string | null) => ({ ...game('game-a', [task('a-open'), task('a-done')]), skipped_until: until }) as unknown as Game
  const data = (g: Game): TodayData => ({
    games: [g, game('game-b', [task('b-open')])],
    completions: new Map([['a-done', [{ id: 'c', at: completedAt }]]]),
    events: [{ id: 'ev', game_id: 'game-a', name: 'Lantern Rite', ends_at: '2026-11-16T20:00:00+08:00' }],
  })

  it('leaves a resting game out of daily progress and the "dailies left" row', () => {
    const today = buildToday(data(resting('2026-11-17T04:00:00+08:00')), now)
    expect(today.dailyProgress).toEqual({ done: 0, total: 1 }) // only game-b counts
    expect(today.cards.find((c) => c.id === 'game-a')).toMatchObject({ skipped: true, dailyDone: 1, dailyTotal: 2 })
    expect(today.attention.map((a) => a.key)).not.toContain('game-a-dailies')
  })

  it('still lists the resting game\'s deadlines, such as an event ending', () => {
    const today = buildToday(data(resting('2026-11-17T04:00:00+08:00')), now)
    expect(today.attention.map((a) => a.title)).toContain('Lantern Rite ends')
  })

  it('ignores a skip that has already run out (the reset passed)', () => {
    const today = buildToday(data(resting('2026-11-16T04:00:00+08:00')), now)
    expect(today.cards.find((c) => c.id === 'game-a')?.skipped).toBe(false)
    expect(today.dailyProgress).toEqual({ done: 1, total: 3 })
    expect(today.attention.map((a) => a.key)).toContain('game-a-dailies')
  })

  it('isSkippedNow matches the reminder job: only a future time counts', () => {
    expect(isSkippedNow({ skipped_until: null }, now)).toBe(false)
    expect(isSkippedNow({ skipped_until: '2026-11-16T12:00:00+08:00' }, now)).toBe(false) // exactly now: over
    expect(isSkippedNow({ skipped_until: '2026-11-16T12:01:00+08:00' }, now)).toBe(true)
  })
})

describe('Needs attention uses the stamina threshold (SUP-3)', () => {
  const withMeter = (ping_at: number | null) => ({
    ...game('genshin', []),
    stamina_meters: [{
      id: 'resin', name: 'Original Resin', cap: 200, minutes_per_point: 8, fills_when_full_of: null,
      current_value: 170, value_recorded_at: '2026-11-16T12:00:00+08:00', ping_at,
    }],
  }) as unknown as Game
  const titles = (ping_at: number | null) =>
    buildToday({ games: [withMeter(ping_at)], completions: new Map(), events: [] }, now).attention.map((a) => a.title)

  it('lists the meter once it reaches your threshold', () => {
    expect(titles(160).some((t) => t.startsWith('Original Resin caps at'))).toBe(true) // 170 ≥ 160
  })

  it('waits for 90% when no threshold is set', () => {
    expect(titles(null).some((t) => t.startsWith('Original Resin caps at'))).toBe(false) // 170 < 180
  })
})
