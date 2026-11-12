// Decides which Discord reminders are due. Pure logic: no database or network here,
// so it can be unit-tested. The "remind" function loads the rows and sends the result.

import { meterStates, type MeterRow } from './stamina.ts'
import { countIn, dailyPeriod, taskPeriod, weeklyPeriod, type ResetClock, type TaskRule } from './time.ts'

export type ReminderTask = TaskRule & {
  id: string
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
  skipped_until: string | null
  tasks: ReminderTask[]
  stamina_meters: MeterRow[]
}

export type ReminderSettings = {
  user_id: string
  timezone: string
  nudge_enabled: boolean
  nudge_time: string // 'HH:MM' or 'HH:MM:SS' in the user's timezone
}

export type Reminder = {
  kind: 'stamina' | 'nudge'
  key: string // saved in notify_log so the same reminder is never sent twice
  text: string
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
const isVisible = (t: ReminderTask) => !t.archived && !t.hidden

// Same rules as the app: weekly-target tasks count across the week, and a daily one ticked today is done for now.
function progress(task: ReminderTask, ats: string[], clock: ResetClock, now: Date) {
  const counted = task.weekly_target != null
  const period = counted ? weeklyPeriod(clock, now) : taskPeriod(task, clock, now)
  const count = period ? countIn(period, ats) : 0
  const done = count >= (task.weekly_target ?? 1)
  const today = counted && task.frequency === 'daily' ? countIn(dailyPeriod(clock, now), ats) > 0 : false
  return { period, doneForNow: done || today }
}

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

// ---- Evening nudge: what is still unticked, once a day at the chosen time ----

export type GameLeft = {
  game: string
  resetAt: Date
  dailies: string[]
  endgame: { title: string; endsAt: Date }[]
}

export function whatsLeft(games: ReminderGame[], completions: Completions, now: Date): GameLeft[] {
  const out: GameLeft[] = []
  for (const game of games) {
    if (!game.notify_nudge || isSkipped(game, now)) continue
    const clock = clockOf(game)
    const ats = (t: ReminderTask) => completions.get(t.id) ?? []

    const dailies = game.tasks
      .filter((t) => t.frequency === 'daily' && t.category !== 'endgame' && isVisible(t) && !t.optional)
      .filter((t) => !progress(t, ats(t), clock, now).doneForNow)
      .map((t) => t.title)

    const endgame: GameLeft['endgame'] = []
    for (const t of game.tasks.filter((x) => x.category === 'endgame' && isVisible(x))) {
      const p = progress(t, ats(t), clock, now)
      if (!p.period?.end || p.doneForNow) continue
      if (p.period.end.getTime() - now.getTime() <= ENDGAME_HORIZON_MS) endgame.push({ title: t.title, endsAt: p.period.end })
    }

    if (dailies.length > 0 || endgame.length > 0) {
      out.push({ game: game.name, resetAt: dailyPeriod(clock, now).end!, dailies, endgame })
    }
  }
  return out
}

// The most recent nudge time that has already passed, in the user's timezone.
export function lastNudgeTime(settings: ReminderSettings, now: Date): Date {
  return dailyPeriod({ timezone: settings.timezone, daily_reset_time: settings.nudge_time, weekly_reset_day: 1 }, now).start
}

export function nudgeReminder(settings: ReminderSettings, games: ReminderGame[], completions: Completions, now: Date): Reminder | null {
  if (!settings.nudge_enabled) return null
  const at = lastNudgeTime(settings, now)
  if (now.getTime() - at.getTime() >= NUDGE_WINDOW_MS) return null

  const left = whatsLeft(games, completions, now)
  if (left.length === 0) return null

  const lines = ['**Still to do today**']
  for (const g of left) {
    lines.push('', `**${g.game}** (daily reset ${relative(g.resetAt)})`)
    for (const title of g.dailies) lines.push(`- ${title}`)
    for (const e of g.endgame) lines.push(`- ${e.title} not cleared, resets ${relative(e.endsAt)}`)
  }
  return { kind: 'nudge', key: `nudge:${settings.user_id}:${at.toISOString()}`, text: lines.join('\n') }
}

export function buildReminders(settings: ReminderSettings, games: ReminderGame[], completions: Completions, now: Date): Reminder[] {
  const nudge = nudgeReminder(settings, games, completions, now)
  return [...staminaReminders(games, now), ...(nudge ? [nudge] : [])]
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