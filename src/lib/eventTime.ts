// Helpers for entering event dates in a game's server time.

import { zonedTime } from './time'

// "2026-11-20" + "03:59" on the server → the real moment, as an ISO string for the database
export function toInstant(date: string, time: string, timezone: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})/.exec(time)
  if (!d || !t) return null
  return zonedTime(+d[1], +d[2], +d[3], +t[1], +t[2], timezone).toISOString()
}

// A stored moment → the date and time the server clock shows, for filling the form
export function serverParts(iso: string, timezone: string): { date: string; time: string } {
  const parts: Record<string, string> = {}
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  for (const p of format.formatToParts(new Date(iso))) parts[p.type] = p.value
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

// Events usually end one minute before the daily reset: "04:00:00" → "03:59"
export function minuteBefore(resetTime: string): string {
  const [h, m] = resetTime.split(':').map(Number)
  const total = ((h || 0) * 60 + (m || 0) + 1439) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
