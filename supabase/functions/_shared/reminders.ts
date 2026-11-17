// Decides which Discord reminders are due. Pure logic: no database or network here,
// so it can be unit-tested. The "remind" function loads the rows and sends the result.

import { meterStates, type MeterRow } from './stamina.ts'
import { progress } from './progress.ts'
import { dailyPeriod, weeklyPeriod, type ResetClock, type TaskRule } from './time.ts'

export type ReminderTask = TaskRule & {
  id: string
  preset_key?: string | null
  title: string
  category: string
  hidden: boolean
  optional: boolean
  archived: boolean
  weekly_target: number | null
}

export type ReminderGame = {
  id: string
  name: string
  timezone: string
  daily_reset_time: string
  weekly_reset_day: number
  notify_nudge: boolean
  notify_stamina: boolean
  notify_events?: boolean
  skipped_until: string | null
  tasks: ReminderTask[]
  stamina_meters: MeterRow[]
}

export type ReminderSettings = {
  user_id: string
  timezone: string
  nudge_enabled: boolean
  nudge_time: string // 'HH:MM' or 'HH:MM:SS' in the user's timezone
  quiet_start?: string | null // stamina pings wait between these two times (user's timezone)
  quiet_end?: string | null
  work_start?: string | null // SUP-4: the same, during work hours, on the days in work_days
  work_end?: string | null
  work_days?: number[] | null // days a work window starts on: 0 = Sunday ... 6 = Saturday
  event_reminder_days?: number // remind this many days before an event ends (0 = off)
}

export type ReminderEvent = {
  id: string
  game_id: string
  name: string
  starts_at: string | null // null = already running
  ends_at: string
  note: string | null
  remind: boolean
  completed_at: string | null
}

export type Reminder = {
  kind: 'stamina' | 'nudge' | 'event'
  key: string // saved in notify_log so the same reminder is never sent twice
  text: string
  eventId?: string // for kind 'event'
}

// task id → when it was ticked (ISO strings)
export type Completions = Map<string, string[]>

const HOUR = 3_600_000
export const STAMINA_WARN_RATIO = 0.9 // ping once a meter is within 10% of its cap
export const NUDGE_WINDOW_MS = 3 * HOUR // a late run can still send the nudge up to 3 h after its time
export const ENDGAME_HORIZON_MS = 24 * HOUR

// Discord shows these in the reader's own timezone.
const unix = (d: Date) => Math.floor(d.getTime() / 1000)
const relative = (d: Date) => `<t:${unix(d)}:R>` // "in 2 hours"
const clockTime = (d: Date) => `<t:${unix(d)}:t>` // "9:16 PM"

const clockOf = (g: ReminderGame): ResetClock => ({
  timezone: g.timezone,
  daily_reset_time: g.daily_reset_time,
  weekly_reset_day: g.weekly_reset_day,
})

const isSkipped = (g: ReminderGame, now: Date) => !!g.skipped_until && new Date(g.skipped_until) > now

// Running right now and not marked as done
const isLive = (e: ReminderEvent, now: Date) =>
  !e.completed_at && new Date(e.ends_at) > now && (!e.starts_at || new Date(e.starts_at) <= now)
const isVisible = (t: ReminderTask) => !t.archived && !t.hidden

// "Is it done?" is the same rule the app uses, from progress.ts

// ---- Quiet hours and work hours (SUP-4): stamina pings and event reminders are held, then sent on the
// first run after the window ends. A window belongs to the day it starts on. ----

export type WindowKind = 'quiet' | 'work'
export type HoldWindow = { kind: WindowKind; start: Date; end: Date }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const weekdayIn = (d: Date, tz: string) =>
  WEEKDAYS.indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d))

function windowTimes(settings: ReminderSettings, kind: WindowKind): { from: string; to: string } | null {
  const from = kind === 'quiet' ? settings.quiet_start : settings.work_start
  const to = kind === 'quiet' ? settings.quiet_end : settings.work_end
  if (!from || !to || from.slice(0, 5) === to.slice(0, 5)) return null
  return { from, to }
}

const onDay = (settings: ReminderSettings, kind: WindowKind, start: Date) =>
  kind === 'quiet' || (settings.work_days ?? [1, 2, 3, 4, 5]).includes(weekdayIn(start, settings.timezone))

const clockAt = (settings: ReminderSettings, time: string) => ({ timezone: settings.timezone, daily_reset_time: time, weekly_reset_day: 1 })

/** The window of this kind that is running now, if any. Works across midnight. */
export function currentWindow(settings: ReminderSettings, kind: WindowKind, now: Date): HoldWindow | null {
  const t = windowTimes(settings, kind)
  if (!t) return null
  // The most recent time the window began, and the first time it ends after that
  const start = dailyPeriod(clockAt(settings, t.from), now).start
  const end = dailyPeriod(clockAt(settings, t.to), start).end!
  return now < end && onDay(settings, kind, start) ? { kind, start, end } : null
}

/** The next window of this kind to begin after now, if it begins on one of its days. */
export function nextWindow(settings: ReminderSettings, kind: WindowKind, now: Date): HoldWindow | null {
  const t = windowTimes(settings, kind)
  if (!t) return null
  const start = dailyPeriod(clockAt(settings, t.from), now).end!
  const end = dailyPeriod(clockAt(settings, t.to), start).end!
  return onDay(settings, kind, start) ? { kind, start, end } : null
}

export function inQuietHours(settings: ReminderSettings, now: Date): boolean {
  return currentWindow(settings, 'quiet', now) !== null
}

export function inWorkHours(settings: ReminderSettings, now: Date): boolean {
  return currentWindow(settings, 'work', now) !== null
}

/** Stamina pings and event reminders wait while either window is running. */
export const isHeld = (settings: ReminderSettings, now: Date) => inQuietHours(settings, now) || inWorkHours(settings, now)

// ---- Stamina: one ping per fill-up, when a meter reaches 90% of its cap ----

export function staminaReminders(games: ReminderGame[], now: Date): Reminder[] {
  const out: Reminder[] = []
  for (const game of games) {
    if (!game.notify_stamina || isSkipped(game, now)) continue
    for (const m of meterStates(game.stamina_meters, now)) {
      if (m.isOverflow) continue
      if (!m.full && m.value < m.cap * STAMINA_WARN_RATIO) continue
      const row = game.stamina_meters.find((r) => r.id === m.id)!
      const be = m.name.endsWith('s') ? 'are' : 'is'
      const text = m.full || !m.fullAt
        ? `**${game.name}**: ${m.name} ${be} full (${m.value}/${m.cap}).`
        : `**${game.name}**: ${m.name} ${be} at ${m.value}/${m.cap}, full ${relative(m.fullAt)} (${clockTime(m.fullAt)}).`
      // The key changes whenever a new value is entered, so each fill-up pings once.
      out.push({ kind: 'stamina', key: `stamina:${m.id}:${new Date(row.value_recorded_at).toISOString()}`, text })
    }
  }
  return out
}

// ---- SUP-4: an early ping before quiet or work hours, for a meter that would fill during them ----

export const EARLY_PING_MS = 30 * 60_000 // within the 30 minutes before the window starts

export function earlyStaminaReminders(settings: ReminderSettings, games: ReminderGame[], now: Date): Reminder[] {
  const soon = (['quiet', 'work'] as const)
    .map((kind) => nextWindow(settings, kind, now))
    .filter((w): w is HoldWindow => !!w && w.start.getTime() - now.getTime() <= EARLY_PING_MS)
  if (soon.length === 0) return []
  const out: Reminder[] = []
  for (const game of games) {
    if (!game.notify_stamina || isSkipped(game, now)) continue
    for (const m of meterStates(game.stamina_meters, now)) {
      if (m.isOverflow || m.full || !m.fullAt) continue
      const w = soon.find((x) => m.fullAt! >= x.start && m.fullAt! < x.end)
      if (!w) continue
      const row = game.stamina_meters.find((r) => r.id === m.id)!
      const be = m.name.endsWith('s') ? 'are' : 'is'
      const label = w.kind === 'quiet' ? 'quiet hours' : 'work hours'
      out.push({
        kind: 'stamina',
        // The same key as the ordinary ping: one ping per fill-up, just sent before the window instead of after it
        key: `stamina:${m.id}:${new Date(row.value_recorded_at).toISOString()}`,
        text: `**${game.name}**: ${m.name} ${be} at ${m.value}/${m.cap} and will be full at ${clockTime(m.fullAt)}, during your ${label}. Spend some now if you can.`,
      })
    }
  }
  return out
}

// ---- Evening nudge: what is still unticked, once a day at the chosen time ----

export type GameLeft = {
  game: string
  resetAt: Date
  dailies: string[]
  weeklies: string[] // only on the last day before the weekly reset
  weeklyResetAt: Date
  endgame: { title: string; endsAt: Date }[]
  events: { name: string; endsAt: Date }[]
}

export function whatsLeft(games: ReminderGame[], completions: Completions, now: Date, events: ReminderEvent[] = []): GameLeft[] {
  const out: GameLeft[] = []
  for (const game of games) {
    if (!game.notify_nudge || isSkipped(game, now)) continue
    const clock = clockOf(game)
    const ats = (t: ReminderTask) => completions.get(t.id) ?? []

    const dailies = game.tasks
      .filter((t) => t.frequency === 'daily' && t.category !== 'endgame' && isVisible(t) && !t.optional)
      .filter((t) => !progress(t, ats(t), clock, now).doneForNow)
      .map((t) => t.title)

    // Weeklies, on the last day before the weekly reset (the nudge then says what would be lost)
    const weeklyEnd = weeklyPeriod(clock, now).end!
    const lastDay = weeklyEnd.getTime() - now.getTime() <= ENDGAME_HORIZON_MS
    const weeklies = !lastDay
      ? []
      : game.tasks
          .filter((t) => t.frequency === 'weekly' && t.category !== 'endgame' && isVisible(t) && !t.optional)
          .map((t) => ({ t, p: progress(t, ats(t), clock, now) }))
          .filter(({ p }) => !p.doneForNow)
          .map(({ t, p }) => (p.target > 1 ? `${t.title} (${p.count} of ${p.target})` : t.title))

    const endgame: GameLeft['endgame'] = []
    for (const t of game.tasks.filter((x) => x.category === 'endgame' && isVisible(x))) {
      const p = progress(t, ats(t), clock, now)
      if (!p.period?.end || p.doneForNow || p.period.start > now) continue // not open yet
      if (p.period.end.getTime() - now.getTime() <= ENDGAME_HORIZON_MS) endgame.push({ title: t.title, endsAt: p.period.end })
    }

    // Events that end within 24 hours and aren't marked as done
    const ending = events
      .filter((e) => e.game_id === game.id && isLive(e, now) && new Date(e.ends_at).getTime() - now.getTime() <= ENDGAME_HORIZON_MS)
      .map((e) => ({ name: e.name, endsAt: new Date(e.ends_at) }))

    if (dailies.length > 0 || weeklies.length > 0 || endgame.length > 0 || ending.length > 0) {
      out.push({ game: game.name, resetAt: dailyPeriod(clock, now).end!, dailies, weeklies, weeklyResetAt: weeklyEnd, endgame, events: ending })
    }
  }
  return out
}

// ---- TSK-8: the nudge is ranked. What expires before tomorrow leads ("Don't miss"), across all games,
// soonest first; core dailies follow, the game whose reset comes first at the top. Optional tasks never ping
// (whatsLeft already leaves them out). ----

export type NudgeLine = { game: string; text: string; at: Date }

export function rankLeft(left: GameLeft[]): { dontMiss: NudgeLine[]; dailies: GameLeft[] } {
  const dontMiss: NudgeLine[] = []
  for (const g of left) {
    for (const e of g.endgame) dontMiss.push({ game: g.game, text: `${e.title} not cleared, resets ${relative(e.endsAt)}`, at: e.endsAt })
    for (const e of g.events) dontMiss.push({ game: g.game, text: `Event: ${e.name} ends ${relative(e.endsAt)}`, at: e.endsAt })
    for (const title of g.weeklies) dontMiss.push({ game: g.game, text: `Weekly: ${title}, resets ${relative(g.weeklyResetAt)}`, at: g.weeklyResetAt })
  }
  // Array sort is stable, so items of one game that end together keep their order
  dontMiss.sort((a, b) => a.at.getTime() - b.at.getTime() || a.game.localeCompare(b.game))
  const dailies = left
    .filter((g) => g.dailies.length > 0)
    .sort((a, b) => a.resetAt.getTime() - b.resetAt.getTime() || a.game.localeCompare(b.game))
  return { dontMiss, dailies }
}

// The most recent nudge time that has already passed, in the user's timezone.
export function lastNudgeTime(settings: ReminderSettings, now: Date): Date {
  return dailyPeriod({ timezone: settings.timezone, daily_reset_time: settings.nudge_time, weekly_reset_day: 1 }, now).start
}

export function nudgeReminder(settings: ReminderSettings, games: ReminderGame[], completions: Completions, now: Date, events: ReminderEvent[] = []): Reminder | null {
  if (!settings.nudge_enabled) return null
  const at = lastNudgeTime(settings, now)
  if (now.getTime() - at.getTime() >= NUDGE_WINDOW_MS) return null

  const left = whatsLeft(games, completions, now, events)
  if (left.length === 0) return null

  const { dontMiss, dailies } = rankLeft(left)
  const lines = ['**Still to do today**']
  if (dontMiss.length > 0) {
    lines.push('', "**Don't miss**")
    for (const l of dontMiss) lines.push(`- **${l.game}**: ${l.text}`)
  }
  if (dailies.length > 0) {
    lines.push('', '**Dailies**')
    dailies.forEach((g, i) => {
      if (i > 0) lines.push('')
      lines.push(`**${g.game}** (daily reset ${relative(g.resetAt)})`)
      for (const title of g.dailies) lines.push(`- ${title}`)
    })
  }
  return { kind: 'nudge', key: `nudge:${settings.user_id}:${at.toISOString()}`, text: lines.join('\n') }
}

// ---- Events: one reminder per event, a set number of days before it ends ----

export function eventReminders(settings: ReminderSettings, games: ReminderGame[], events: ReminderEvent[], now: Date): Reminder[] {
  const days = settings.event_reminder_days ?? 2
  if (days <= 0) return []
  const out: Reminder[] = []
  for (const e of events) {
    const game = games.find((g) => g.id === e.game_id)
    if (!game || game.notify_events === false || isSkipped(game, now)) continue
    if (!e.remind || !isLive(e, now)) continue
    const endsAt = new Date(e.ends_at)
    if (endsAt.getTime() - now.getTime() > days * 24 * HOUR) continue
    const note = e.note?.trim() ? ` Progress: ${e.note.trim()}` : ''
    out.push({
      kind: 'event',
      eventId: e.id,
      // The end time is part of the key, so moving the end date allows a fresh reminder.
      key: `event:${e.id}:${endsAt.toISOString()}`,
      text: `**${game.name}**: ${e.name} ends ${relative(endsAt)} (<t:${unix(endsAt)}:f>).${note}`,
    })
  }
  return out
}

export function buildReminders(settings: ReminderSettings, games: ReminderGame[], completions: Completions, now: Date, events: ReminderEvent[] = []): Reminder[] {
  const nudge = nudgeReminder(settings, games, completions, now, events)
  // Held reminders are not recorded as sent, so they go out once quiet or work hours are over.
  const held = isHeld(settings, now)
  // An early ping shares its key with the ordinary one, so the meter is pinged once, with the clearer text
  const byKey = new Map<string, Reminder>()
  if (!held) for (const r of [...staminaReminders(games, now), ...earlyStaminaReminders(settings, games, now)]) byKey.set(r.key, r)
  const stamina = [...byKey.values()]
  const ending = held ? [] : eventReminders(settings, games, events, now)
  return [...stamina, ...ending, ...(nudge ? [nudge] : [])]
}

// When an event's own reminder goes out in the same run as the evening nudge, the nudge leaves that event
// out, so it isn't listed twice in one message. `fresh` is what is actually being sent (not sent before).
export function withoutRepeatedEvents(
  fresh: Reminder[], settings: ReminderSettings, games: ReminderGame[], completions: Completions, now: Date, events: ReminderEvent[],
): Reminder[] {
  const sentNow = new Set(fresh.filter((r) => r.kind === 'event' && r.eventId).map((r) => r.eventId!))
  if (sentNow.size === 0 || !fresh.some((r) => r.kind === 'nudge')) return fresh
  const nudge = nudgeReminder(settings, games, completions, now, events.filter((e) => !sentNow.has(e.id)))
  return fresh.flatMap((r) => (r.kind !== 'nudge' ? [r] : nudge ? [{ ...r, text: nudge.text }] : []))
}

// Discord allows 2,000 characters per message; group reminders into messages under that.
export function toMessages(reminders: Reminder[], limit = 1900): { keys: string[]; content: string }[] {
  const out: { keys: string[]; content: string }[] = []
  for (const r of reminders) {
    const text = r.text.length > limit ? `${r.text.slice(0, limit - 1)}…` : r.text
    const last = out[out.length - 1]
    if (last && last.content.length + 2 + text.length <= limit) {
      last.keys.push(r.key)
      last.content += `\n\n${text}`
    } else {
      out.push({ keys: [r.key], content: text })
    }
  }
  return out
}
