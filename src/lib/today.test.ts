import { describe, expect, it } from 'vitest'
import { buildToday, cardHeadline, isSkippedNow, leftByReset, meterTag, type Game, type GameCard, type Task, type TodayData } from './today'

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

describe('Today card data for the redesigned cards (THM-8)', () => {
  const g = {
    ...game('wuwa', [
      task('d1'), task('d2'),
      task('w1', { frequency: 'weekly' }), task('w2', { frequency: 'weekly' }), task('w-opt', { frequency: 'weekly', optional: true }),
      task('end', { category: 'endgame', frequency: 'interval', cycle_anchor: '2026-11-09', cycle_days: 28 }),
    ]),
    stamina_meters: [
      { id: 'plates', name: 'Waveplates', cap: 240, minutes_per_point: 6, fills_when_full_of: null, current_value: 230, value_recorded_at: '2026-11-16T12:00:00+08:00', ping_at: null },
      { id: 'crystals', name: 'Waveplate Crystals', cap: 480, minutes_per_point: 12, fills_when_full_of: 'plates', current_value: 250, value_recorded_at: '2026-11-16T12:00:00+08:00', ping_at: null },
    ],
  } as unknown as Game
  const data: TodayData = { games: [g], completions: new Map([['w1', [{ id: 'c', at: completedAt }]]]), events: [] }
  const [card] = buildToday(data, now).cards

  it('counts this week\'s weeklies (optional ones left out)', () => {
    expect([card.weeklyDone, card.weeklyTotal]).toEqual([1, 2])
  })

  it('keeps the overflow meter apart from the main one', () => {
    expect(card.meter?.name).toBe('Waveplates')
    expect(card.overflow?.name).toBe('Waveplate Crystals')
  })

  it('knows when the main meter is at its ping threshold, and that the game has endgame', () => {
    expect(card.meterSoon).toBe(true) // 230 ≥ 216 (90% of 240)
    expect(card.hasEndgame).toBe(true)
  })
})

describe('which number leads a Today card (THM-8)', () => {
  const at = (iso: string) => new Date(iso)
  const base = {
    meter: { id: 'm', name: 'Resin', cap: 200, value: 142, full: false, isOverflow: false, fullAt: at('2026-11-16T23:50:00+08:00'), nextPointAt: null },
    skipped: false, dailyDone: 4, dailyTotal: 6, resetAt: at('2026-11-17T04:00:00+08:00'), meterSoon: false,
  } as unknown as GameCard

  it('shows the meter most of the day', () => {
    expect(cardHeadline(base, now)).toBe('meter')
  })

  it('switches to the dailies in the last 3 hours before reset, if any are left', () => {
    expect(cardHeadline(base, at('2026-11-17T01:00:00+08:00'))).toBe('dailies')
    expect(cardHeadline({ ...base, dailyDone: 6 }, at('2026-11-17T01:00:00+08:00'))).toBe('meter')
  })

  it('keeps the meter for a resting game, and uses dailies when there is no meter', () => {
    expect(cardHeadline({ ...base, skipped: true }, at('2026-11-17T01:00:00+08:00'))).toBe('meter')
    expect(cardHeadline({ ...base, meter: null }, now)).toBe('dailies')
  })

  it('tags the meter with when it fills, and flags it near or above the cap', () => {
    // The tag shows the device's own clock, so these times are made in local time: the test then passes
    // in any timezone (CI runs on UTC). new Date(y, monthIndex, d, h, m) is local time.
    const noon = new Date(2026, 10, 16, 12, 0)
    const local = (d: number, h: number, m: number) => ({ ...base, meter: { ...base.meter!, fullAt: new Date(2026, 10, d, h, m) } })
    expect(meterTag(local(16, 23, 50), noon)).toEqual({ text: 'Full 11:50 PM', short: '11:50 PM', urgent: false })
    expect(meterTag(local(17, 6, 30), noon)).toEqual({ text: 'Full tmrw 6:30 AM', short: 'Tmrw 6:30 AM', urgent: false })
    expect(meterTag({ ...base, meterSoon: true }, now)).toEqual({ text: 'Caps in 11h 50m', short: 'in 11h 50m', urgent: true })
    expect(meterTag({ ...base, meter: { ...base.meter!, value: 200, full: true, fullAt: null } }, now)).toEqual({ text: 'Full now', short: 'Now', urgent: true })
    expect(meterTag({ ...base, meter: { ...base.meter!, value: 230, full: true, fullAt: null } }, now)).toEqual({ text: 'Above cap +30', short: '+30', urgent: true })
    expect(meterTag({ ...base, meter: null }, now)).toBeNull()
  })
})

describe('leftByReset', () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 19, h, m))
  it('groups games that reset at the same time, soonest first', () => {
    const groups = leftByReset([
      { skipped: false, dailyDone: 0, dailyTotal: 7, resetAt: at(21) }, // NTE, an hour later
      { skipped: false, dailyDone: 0, dailyTotal: 6, resetAt: at(20) }, // Genshin
      { skipped: false, dailyDone: 0, dailyTotal: 3, resetAt: at(20, 0) }, // WuWa, same reset
    ])
    expect(groups).toEqual([{ at: at(20), left: 9 }, { at: at(21), left: 7 }])
  })

  it('leaves out resting games and games with nothing left', () => {
    expect(leftByReset([
      { skipped: true, dailyDone: 0, dailyTotal: 5, resetAt: at(20) },
      { skipped: false, dailyDone: 4, dailyTotal: 4, resetAt: at(20) },
      { skipped: false, dailyDone: 1, dailyTotal: 3, resetAt: at(21) },
    ])).toEqual([{ at: at(21), left: 2 }])
  })

  it('treats resets within the same minute as one', () => {
    expect(leftByReset([
      { skipped: false, dailyDone: 0, dailyTotal: 1, resetAt: new Date(at(20).getTime() + 5_000) },
      { skipped: false, dailyDone: 0, dailyTotal: 2, resetAt: at(20) },
    ])).toEqual([{ at: at(20), left: 3 }])
  })
})
