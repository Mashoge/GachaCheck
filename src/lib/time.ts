// Reset and countdown math. Everything works in each game's server timezone.
// Phase 3 adds unit tests for these functions.

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const DAY_MS = 86_400_000

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number; wd: number }

const formatters = new Map<string, Intl.DateTimeFormat>()

function zonedParts(date: Date, tz: string): Parts {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    formatters.set(tz, f)
  }
  const p: Record<string, string> = {}
  for (const part of f.formatToParts(date)) p[part.type] = part.value
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, wd: WEEKDAYS[p.weekday] }
}

function offsetMs(date: Date, tz: string) {
  const p = zonedParts(date, tz)
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000
}

// A wall-clock time in `tz` as a real instant. Day/month overflow is fine (d = 0 means the last day of the previous month).
export function zonedTime(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi)
  let t = guess - offsetMs(new Date(guess), tz)
  t = guess - offsetMs(new Date(t), tz)
  return new Date(t)
}

function resetHM(resetTime: string): [number, number] {
  const [h, mi] = resetTime.split(':').map(Number)
  return [h || 0, mi || 0]
}

export type ResetClock = { timezone: string; daily_reset_time: string; weekly_reset_day: number }

export type TaskRule = {
  frequency: string
  monthly_day: number | null
  cycle_anchor: string | null
  cycle_days: number | null
  cycle_ends_at: string | null
}

// The window a task's completion counts for. `end` is null when the next reset is unknown.
export type Period = { start: Date; end: Date | null }

export function dailyPeriod(clock: ResetClock, now: Date): Period {
  const tz = clock.timezone
  const [h, mi] = resetHM(clock.daily_reset_time)
  const p = zonedParts(now, tz)
  let start = zonedTime(p.y, p.m, p.d, h, mi, tz)
  if (start > now) start = zonedTime(p.y, p.m, p.d - 1, h, mi, tz)
  const sp = zonedParts(start, tz)
  return { start, end: zonedTime(sp.y, sp.m, sp.d + 1, h, mi, tz) }
}

export function weeklyPeriod(clock: ResetClock, now: Date): Period {
  const tz = clock.timezone
  const [h, mi] = resetHM(clock.daily_reset_time)
  const day = clock.weekly_reset_day % 7 // accepts 0–6 (Sun = 0) or 1–7 (Sun = 7)
  const p = zonedParts(now, tz)
  const back = (p.wd - day + 7) % 7
  let start = zonedTime(p.y, p.m, p.d - back, h, mi, tz)
  if (start > now) start = zonedTime(p.y, p.m, p.d - back - 7, h, mi, tz)
  const sp = zonedParts(start, tz)
  return { start, end: zonedTime(sp.y, sp.m, sp.d + 7, h, mi, tz) }
}

export function taskPeriod(rule: TaskRule, clock: ResetClock, now: Date): Period | null {
  const tz = clock.timezone
  const [h, mi] = resetHM(clock.daily_reset_time)

  switch (rule.frequency) {
    case 'daily':
      return dailyPeriod(clock, now)
    case 'weekly':
      return weeklyPeriod(clock, now)
    case 'monthly': {
      if (!rule.monthly_day) return null
      const p = zonedParts(now, tz)
      let start = zonedTime(p.y, p.m, rule.monthly_day, h, mi, tz)
      if (start > now) start = zonedTime(p.y, p.m - 1, rule.monthly_day, h, mi, tz)
      const sp = zonedParts(start, tz)
      return { start, end: zonedTime(sp.y, sp.m + 1, rule.monthly_day, h, mi, tz) }
    }
    case 'interval': {
      if (!rule.cycle_anchor || !rule.cycle_days) return null
      const [ay, am, ad] = rule.cycle_anchor.split('-').map(Number)
      const anchor = zonedTime(ay, am, ad, h, mi, tz).getTime()
      const cycle = rule.cycle_days * DAY_MS
      const k = Math.floor((now.getTime() - anchor) / cycle)
      const start = new Date(anchor + k * cycle)
      return { start, end: new Date(start.getTime() + cycle) }
    }
    case 'dated': {
      if (!rule.cycle_ends_at) return null
      const end = parseServerLocal(rule.cycle_ends_at, tz)
      if (end <= now) return null
      // Assumption until each mode's length is confirmed: a completion in the last 28 days counts.
      return { start: new Date(end.getTime() - 28 * DAY_MS), end }
    }
    case 'none':
      return { start: new Date(0), end: null }
    default:
      return null
  }
}

// "2026-11-12T04:00:00" written in server time → real instant
function parseServerLocal(value: string, tz: string): Date {
  const [date, time = '00:00'] = value.replace(' ', 'T').split('T')
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  return zonedTime(y, m, d, h || 0, mi || 0, tz)
}

// How many completions fall inside the period.
export function countIn(period: Period, completedAts: string[]): number {
  const start = period.start.getTime()
  const end = period.end ? period.end.getTime() : Infinity
  return completedAts.filter((iso) => {
    const t = new Date(iso).getTime()
    return t >= start && t < end
  }).length
}

// ---- Formatting ----

export function formatDuration(ms: number): string {
  if (ms <= 0) return 'Now'
  const totalMin = Math.ceil(ms / 60_000)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

// Clock time on this device, e.g. "1:41 AM"
export function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

// "7:56 AM" today, "tomorrow 7:56 AM", "Wed 7:56 AM" this week, otherwise "Nov 20, 7:56 AM"
export function formatWhen(date: Date, now: Date): string {
  const time = formatClock(date)
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000)
  if (days === 0) return time
  if (days === 1) return `tomorrow ${time}`
  if (days > 1 && days < 7) return `${date.toLocaleDateString([], { weekday: 'short' })} ${time}`
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}