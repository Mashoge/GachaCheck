import { describe, expect, it } from 'vitest'
import { buildToday, type Game, type Task, type TodayData } from './today'

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
