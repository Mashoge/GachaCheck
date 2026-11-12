import { describe, expect, it } from 'vitest'
import { countIn, dailyPeriod, formatDuration, formatWhen, taskPeriod, weeklyPeriod, type ResetClock, type TaskRule } from './time'

// Server clocks used by the presets. 'Etc/GMT-8' means UTC+8 (the sign is flipped).
const ASIA_4AM: ResetClock = { timezone: 'Etc/GMT-8', daily_reset_time: '04:00', weekly_reset_day: 1 } // Genshin Asia, WuWa SEA/HMT
const AMERICA_4AM: ResetClock = { timezone: 'Etc/GMT+5', daily_reset_time: '04:00', weekly_reset_day: 1 } // Genshin/WuWa America (UTC-5)
const NTE_ASIA: ResetClock = { timezone: 'Etc/GMT-8', daily_reset_time: '05:00', weekly_reset_day: 1 }
const NTE_AMERICA: ResetClock = { timezone: 'America/New_York', daily_reset_time: '05:00', weekly_reset_day: 1 } // has daylight saving

// Write times with their offset so each test reads as server time.
const at = (iso: string) => new Date(iso)

const rule = (r: Partial<TaskRule>): TaskRule => ({
  frequency: 'daily', monthly_day: null, cycle_anchor: null, cycle_days: null, cycle_ends_at: null, ...r,
})

describe('daily reset', () => {
  it('3:59 AM still belongs to the previous day', () => {
    const p = dailyPeriod(ASIA_4AM, at('2026-11-09T03:59:00+08:00'))
    expect(p.start).toEqual(at('2026-11-08T04:00:00+08:00'))
    expect(p.end).toEqual(at('2026-11-09T04:00:00+08:00'))
  })

  it('a new day starts at exactly 4:00 AM', () => {
    const p = dailyPeriod(ASIA_4AM, at('2026-11-09T04:00:00+08:00'))
    expect(p.start).toEqual(at('2026-11-09T04:00:00+08:00'))
    expect(p.end).toEqual(at('2026-11-10T04:00:00+08:00'))
  })

  it('accepts the database format 04:00:00', () => {
    const p = dailyPeriod({ ...ASIA_4AM, daily_reset_time: '04:00:00' }, at('2026-11-09T06:10:00+08:00'))
    expect(p.start).toEqual(at('2026-11-09T04:00:00+08:00'))
  })

  it('NTE resets at 5:00 AM, so 4:30 AM is still the previous day', () => {
    const p = dailyPeriod(NTE_ASIA, at('2026-11-09T04:30:00+08:00'))
    expect(p.start).toEqual(at('2026-11-08T05:00:00+08:00'))
  })

  it('a tick at 2:59 AM counts for the previous day, not today', () => {
    const tick = ['2026-11-09T02:59:00+08:00']
    expect(countIn(dailyPeriod(ASIA_4AM, at('2026-11-09T03:30:00+08:00')), tick)).toBe(1)
    expect(countIn(dailyPeriod(ASIA_4AM, at('2026-11-09T06:10:00+08:00')), tick)).toBe(0)
  })

  it('America server (UTC-5) resets at 5:00 PM Manila time', () => {
    const before = dailyPeriod(AMERICA_4AM, at('2026-11-09T16:59:00+08:00'))
    const after = dailyPeriod(AMERICA_4AM, at('2026-11-09T17:00:00+08:00'))
    expect(before.start).toEqual(at('2026-11-08T04:00:00-05:00'))
    expect(after.start).toEqual(at('2026-11-09T04:00:00-05:00'))
  })

  it('follows daylight saving: the spring-forward day is 23 hours long', () => {
    // US clocks move forward on Mar 14, 2027
    const p = dailyPeriod(NTE_AMERICA, at('2027-03-13T12:00:00-05:00'))
    expect(p.start).toEqual(at('2027-03-13T05:00:00-05:00'))
    expect(p.end).toEqual(at('2027-03-14T05:00:00-04:00'))
    expect(p.end!.getTime() - p.start.getTime()).toBe(23 * 3_600_000)
  })

  it('follows daylight saving: the fall-back day is 25 hours long', () => {
    // US clocks move back on Nov 7, 2027
    const p = dailyPeriod(NTE_AMERICA, at('2027-11-06T12:00:00-04:00'))
    expect(p.end).toEqual(at('2027-11-07T05:00:00-05:00'))
    expect(p.end!.getTime() - p.start.getTime()).toBe(25 * 3_600_000)
  })
})

describe('weekly reset (Monday 4:00 AM)', () => {
  it('Monday 3:59 AM still belongs to last week', () => {
    const p = weeklyPeriod(ASIA_4AM, at('2026-11-09T03:59:00+08:00'))
    expect(p.start).toEqual(at('2026-11-02T04:00:00+08:00'))
    expect(p.end).toEqual(at('2026-11-09T04:00:00+08:00'))
  })

  it('a new week starts Monday at exactly 4:00 AM', () => {
    const p = weeklyPeriod(ASIA_4AM, at('2026-11-09T04:00:00+08:00'))
    expect(p.start).toEqual(at('2026-11-09T04:00:00+08:00'))
    expect(p.end).toEqual(at('2026-11-16T04:00:00+08:00'))
  })

  it('late Sunday night is still the same week', () => {
    const p = weeklyPeriod(ASIA_4AM, at('2026-11-15T23:59:00+08:00'))
    expect(p.start).toEqual(at('2026-11-09T04:00:00+08:00'))
  })

  it('Sunday can be written as 0 or 7', () => {
    const now = at('2026-11-11T12:00:00+08:00') // a Wednesday
    const a = weeklyPeriod({ ...ASIA_4AM, weekly_reset_day: 0 }, now)
    const b = weeklyPeriod({ ...ASIA_4AM, weekly_reset_day: 7 }, now)
    expect(a.start).toEqual(at('2026-11-08T04:00:00+08:00'))
    expect(b.start).toEqual(a.start)
  })
})

describe('monthly reset', () => {
  const abyss = rule({ frequency: 'monthly', monthly_day: 16 })
  const theater = rule({ frequency: 'monthly', monthly_day: 1 })

  it('Spiral Abyss: resets on the 16th', () => {
    const p = taskPeriod(abyss, ASIA_4AM, at('2026-11-09T06:10:00+08:00'))!
    expect(p.start).toEqual(at('2026-10-16T04:00:00+08:00'))
    expect(p.end).toEqual(at('2026-11-16T04:00:00+08:00'))
  })

  it('the next end date rolls into the new year', () => {
    const p = taskPeriod(abyss, ASIA_4AM, at('2026-12-20T12:00:00+08:00'))!
    expect(p.end).toEqual(at('2027-01-16T04:00:00+08:00'))
  })

  it('Imaginarium Theater: Jan 1, 3:59 AM is still December', () => {
    const p = taskPeriod(theater, ASIA_4AM, at('2027-01-01T03:59:00+08:00'))!
    expect(p.start).toEqual(at('2026-12-01T04:00:00+08:00'))
    expect(p.end).toEqual(at('2027-01-01T04:00:00+08:00'))
  })

  it('Imaginarium Theater: Jan 1, 4:00 AM starts January', () => {
    const p = taskPeriod(theater, ASIA_4AM, at('2027-01-01T04:00:00+08:00'))!
    expect(p.start).toEqual(at('2027-01-01T04:00:00+08:00'))
    expect(p.end).toEqual(at('2027-02-01T04:00:00+08:00'))
  })

  it('no day set means no period', () => {
    expect(taskPeriod(rule({ frequency: 'monthly' }), ASIA_4AM, at('2026-11-09T06:10:00+08:00'))).toBeNull()
  })
})

describe('repeating cycles (interval)', () => {
  const tower = rule({ frequency: 'interval', cycle_anchor: '2026-09-14', cycle_days: 28 })
  const rails = rule({ frequency: 'interval', cycle_anchor: '2026-11-05', cycle_days: 14 })

  it('Tower of Adversity: 3:59 AM on Nov 9 is the end of the old cycle', () => {
    const p = taskPeriod(tower, ASIA_4AM, at('2026-11-09T03:59:00+08:00'))!
    expect(p.start).toEqual(at('2026-10-12T04:00:00+08:00'))
    expect(p.end).toEqual(at('2026-11-09T04:00:00+08:00'))
  })

  it('Tower of Adversity: a new cycle starts Nov 9 at 4:00 AM, next one Dec 7', () => {
    const p = taskPeriod(tower, ASIA_4AM, at('2026-11-09T06:10:00+08:00'))!
    expect(p.start).toEqual(at('2026-11-09T04:00:00+08:00'))
    expect(p.end).toEqual(at('2026-12-07T04:00:00+08:00'))
  })

  it('Beyond the Rails: current route ends Nov 19 at 5:00 AM', () => {
    const p = taskPeriod(rails, NTE_ASIA, at('2026-11-09T06:10:00+08:00'))!
    expect(p.start).toEqual(at('2026-11-05T05:00:00+08:00'))
    expect(p.end).toEqual(at('2026-11-19T05:00:00+08:00'))
  })

  it('works for dates before the anchor', () => {
    const p = taskPeriod(rails, NTE_ASIA, at('2026-11-01T12:00:00+08:00'))!
    expect(p.start).toEqual(at('2026-10-22T05:00:00+08:00'))
  })

  it('keeps the 5:00 AM reset across daylight saving (NTE America)', () => {
    // The cycle from Mar 11 to Mar 25, 2027 crosses the Mar 14 clock change.
    const p = taskPeriod(rails, NTE_AMERICA, at('2027-03-20T12:00:00-04:00'))!
    expect(p.start).toEqual(at('2027-03-11T05:00:00-05:00'))
    expect(p.end).toEqual(at('2027-03-25T05:00:00-04:00'))
  })
})

describe('fixed end date (dated)', () => {
  const endstate = rule({ frequency: 'dated', cycle_ends_at: '2026-11-12T04:00' })

  it('Endstate Matrix ends Nov 12 at 4:00 AM server time', () => {
    const p = taskPeriod(endstate, ASIA_4AM, at('2026-11-09T06:10:00+08:00'))!
    expect(p.end).toEqual(at('2026-11-12T04:00:00+08:00'))
    expect(p.start).toEqual(at('2026-10-15T04:00:00+08:00')) // assumed 28-day window
  })

  it('accepts the database format with seconds', () => {
    const p = taskPeriod(rule({ frequency: 'dated', cycle_ends_at: '2026-11-12T04:00:00' }), ASIA_4AM, at('2026-11-09T06:10:00+08:00'))!
    expect(p.end).toEqual(at('2026-11-12T04:00:00+08:00'))
  })

  it('a clear from the previous cycle does not count once the next end date is set', () => {
    // Previous cycle ended Nov 12; the next one ends Nov 26 (a 14-day cycle).
    const next = rule({ frequency: 'dated', cycle_ends_at: '2026-11-26T04:00', cycle_anchor: '2026-11-12' })
    const p = taskPeriod(next, ASIA_4AM, at('2026-11-13T12:00:00+08:00'))!
    expect(p.start).toEqual(at('2026-11-12T04:00:00+08:00'))
    expect(countIn(p, ['2026-11-10T20:00:00+08:00'])).toBe(0) // cleared last cycle
    expect(countIn(p, ['2026-11-13T09:00:00+08:00'])).toBe(1) // cleared this cycle
  })

  it('an old start day is ignored when it is more than 28 days before the end', () => {
    const r = rule({ frequency: 'dated', cycle_ends_at: '2026-11-26T04:00', cycle_anchor: '2026-09-01' })
    const p = taskPeriod(r, ASIA_4AM, at('2026-11-13T12:00:00+08:00'))!
    expect(p.start).toEqual(at('2026-10-29T04:00:00+08:00'))
  })

  it('after the end date there is no period until new dates are added', () => {
    expect(taskPeriod(endstate, ASIA_4AM, at('2026-11-12T04:00:00+08:00'))).toBeNull()
  })

  it('no end date means no period', () => {
    expect(taskPeriod(rule({ frequency: 'dated' }), ASIA_4AM, at('2026-11-09T06:10:00+08:00'))).toBeNull()
  })
})

describe('one-time goals (none)', () => {
  it('never resets, so every tick counts', () => {
    const p = taskPeriod(rule({ frequency: 'none' }), ASIA_4AM, at('2026-11-09T06:10:00+08:00'))!
    expect(p.end).toBeNull()
    expect(countIn(p, ['2025-01-01T00:00:00Z', '2026-11-09T05:00:00+08:00'])).toBe(2)
  })
})

describe('countIn', () => {
  const p = { start: at('2026-11-09T04:00:00+08:00'), end: at('2026-11-10T04:00:00+08:00') }

  it('includes a tick exactly at the start', () => {
    expect(countIn(p, ['2026-11-09T04:00:00+08:00'])).toBe(1)
  })

  it('excludes a tick exactly at the end (that belongs to the next period)', () => {
    expect(countIn(p, ['2026-11-10T04:00:00+08:00'])).toBe(0)
  })

  it('counts several ticks in one period', () => {
    expect(countIn(p, ['2026-11-09T05:00:00+08:00', '2026-11-09T20:00:00+08:00', '2026-11-08T23:00:00+08:00'])).toBe(2)
  })
})

describe('formatDuration', () => {
  const MIN = 60_000
  it.each([
    [0, 'Now'],
    [-5 * MIN, 'Now'],
    [30_000, '1m'], // rounds up so it never shows 0m
    [12 * MIN, '12m'],
    [60 * MIN, '1h'],
    [(6 * 60 + 40) * MIN, '6h 40m'],
    [(59 * 60 + 59.5) * MIN, '2d 12h'],
    [48 * 60 * MIN, '2d'],
    [(54 * 60 + 10) * MIN, '2d 6h'], // minutes are dropped once it's over a day
  ])('%d ms → %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })
})

describe('formatWhen', () => {
  // Built from this device's local time, so these pass in any timezone.
  const now = new Date(2026, 10, 9, 6, 10) // Mon Nov 9, 6:10 AM

  it('later today shows only the time', () => {
    expect(formatWhen(new Date(2026, 10, 9, 7, 56), now)).not.toMatch(/tomorrow|,/)
  })

  it('the next day says tomorrow', () => {
    expect(formatWhen(new Date(2026, 10, 10, 7, 56), now)).toMatch(/^tomorrow /)
  })

  it('a few days away shows the weekday', () => {
    expect(formatWhen(new Date(2026, 10, 12, 4, 0), now)).not.toMatch(/tomorrow|,/)
    expect(formatWhen(new Date(2026, 10, 12, 4, 0), now)).not.toBe(formatWhen(new Date(2026, 10, 9, 4, 0), now))
  })

  it('a week or more away shows the date', () => {
    expect(formatWhen(new Date(2026, 10, 19, 5, 0), now)).toMatch(/,/)
  })
})