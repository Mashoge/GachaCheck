import { describe, expect, it } from 'vitest'
import {
  buildReminders, eventReminders, inQuietHours, nudgeReminder, staminaReminders, toMessages, whatsLeft,
  type Completions, type ReminderEvent, type ReminderGame, type ReminderSettings, type ReminderTask,
} from '../../supabase/functions/_shared/reminders.ts'

const at = (iso: string) => new Date(iso)
const NINE_PM = at('2026-11-12T21:00:00+08:00') // Thursday, Manila

const settings: ReminderSettings = { user_id: 'u1', timezone: 'Asia/Manila', nudge_enabled: true, nudge_time: '21:00:00' }

const task = (id: string, extra: Partial<ReminderTask> = {}): ReminderTask => ({
  id, title: id, frequency: 'daily', category: 'routine', hidden: false, optional: false, archived: false,
  weekly_target: null, monthly_day: null, cycle_anchor: null, cycle_days: null, cycle_ends_at: null, ...extra,
})

const game = (extra: Partial<ReminderGame> = {}): ReminderGame => ({
  id: 'g1', name: 'Wuthering Waves', timezone: 'Etc/GMT-8', daily_reset_time: '04:00:00', weekly_reset_day: 1,
  notify_nudge: true, notify_stamina: true, skipped_until: null, tasks: [], stamina_meters: [], ...extra,
})

// Waveplates: 240 cap, 1 per 6 minutes
const waveplates = (value: number, recordedAt: string) => ({
  id: 'wp', name: 'Waveplates', cap: 240, minutes_per_point: 6, fills_when_full_of: null,
  current_value: value, value_recorded_at: recordedAt,
})

const ticks = (entries: Record<string, string[]>): Completions => new Map(Object.entries(entries))

describe('stamina ping', () => {
  const recorded = '2026-11-12T12:00:00+08:00'

  it('stays quiet below 90% of the cap', () => {
    // 200 at noon → 215 at 1:30 PM (216 is the 90% mark)
    const g = game({ stamina_meters: [waveplates(200, recorded)] })
    expect(staminaReminders([g], at('2026-11-12T13:30:00+08:00'))).toEqual([])
  })

  it('pings once the meter reaches 90%, with the time it fills', () => {
    const g = game({ stamina_meters: [waveplates(200, recorded)] })
    const [r] = staminaReminders([g], at('2026-11-12T13:36:00+08:00'))
    expect(r.kind).toBe('stamina')
    expect(r.text).toContain('Waveplates are at 216/240')
    const fullAt = Math.floor(at('2026-11-12T16:00:00+08:00').getTime() / 1000)
    expect(r.text).toContain(`<t:${fullAt}:R>`)
  })

  it('keeps the same key for the whole fill-up, so it is sent once', () => {
    const g = game({ stamina_meters: [waveplates(200, recorded)] })
    const early = staminaReminders([g], at('2026-11-12T13:36:00+08:00'))[0]
    const late = staminaReminders([g], at('2026-11-12T20:00:00+08:00'))[0]
    expect(late.key).toBe(early.key)
    expect(late.text).toContain('Waveplates are full (240/240)')
  })

  it('gets a new key after a new value is entered', () => {
    const a = staminaReminders([game({ stamina_meters: [waveplates(230, recorded)] })], NINE_PM)[0]
    const b = staminaReminders([game({ stamina_meters: [waveplates(230, '2026-11-12T20:00:00+08:00')] })], NINE_PM)[0]
    expect(b.key).not.toBe(a.key)
  })

  it('respects the per-game switch and a skipped game', () => {
    const meters = [waveplates(240, recorded)]
    expect(staminaReminders([game({ stamina_meters: meters, notify_stamina: false })], NINE_PM)).toEqual([])
    expect(staminaReminders([game({ stamina_meters: meters, skipped_until: '2026-11-13T04:00:00+08:00' })], NINE_PM)).toEqual([])
    expect(staminaReminders([game({ stamina_meters: meters, skipped_until: '2026-11-12T04:00:00+08:00' })], NINE_PM)).toHaveLength(1)
  })

  it('ignores overflow meters such as Waveplate Crystals', () => {
    const crystals = { id: 'cr', name: 'Waveplate Crystals', cap: 480, minutes_per_point: 12, fills_when_full_of: 'wp', current_value: 480, value_recorded_at: recorded }
    const out = staminaReminders([game({ stamina_meters: [waveplates(100, '2026-11-12T20:00:00+08:00'), crystals] })], NINE_PM)
    expect(out).toEqual([])
  })
})

describe("what's left", () => {
  const tasks = [
    task('Daily activity'),
    task('Spend Waveplates'),
    task('Check mail', { optional: true }),
    task('Hidden one', { hidden: true }),
    task('Old one', { archived: true }),
    task('Weekly bosses', { frequency: 'weekly' }),
  ]

  it('lists unticked dailies only; optional, hidden, archived and weekly tasks are left out', () => {
    const [g] = whatsLeft([game({ tasks })], ticks({}), NINE_PM)
    expect(g.dailies).toEqual(['Daily activity', 'Spend Waveplates'])
    expect(g.resetAt).toEqual(at('2026-11-13T04:00:00+08:00'))
  })

  it('a tick from before the 4:00 AM reset does not count for today', () => {
    const done = ticks({ 'Daily activity': ['2026-11-12T03:30:00+08:00'], 'Spend Waveplates': ['2026-11-12T08:00:00+08:00'] })
    expect(whatsLeft([game({ tasks })], done, NINE_PM)[0].dailies).toEqual(['Daily activity'])
  })

  it('a game with everything done is left out', () => {
    const done = ticks({ 'Daily activity': ['2026-11-12T08:00:00+08:00'], 'Spend Waveplates': ['2026-11-12T08:00:00+08:00'] })
    expect(whatsLeft([game({ tasks })], done, NINE_PM)).toEqual([])
  })

  it('includes endgame that is not cleared and ends within 24 hours', () => {
    const soon = task('Endstate Matrix', { category: 'endgame', frequency: 'dated', cycle_ends_at: '2026-11-13T04:00:00' })
    const later = task('Tower of Adversity', { category: 'endgame', frequency: 'interval', cycle_anchor: '2026-09-14', cycle_days: 28 })
    const [g] = whatsLeft([game({ tasks: [soon, later] })], ticks({}), NINE_PM)
    expect(g.dailies).toEqual([])
    expect(g.endgame).toEqual([{ title: 'Endstate Matrix', endsAt: at('2026-11-13T04:00:00+08:00') }])
    expect(g.events).toEqual([])
  })

  it('leaves out endgame that is already cleared this cycle', () => {
    const soon = task('Endstate Matrix', { category: 'endgame', frequency: 'dated', cycle_ends_at: '2026-11-13T04:00:00' })
    expect(whatsLeft([game({ tasks: [soon] })], ticks({ 'Endstate Matrix': ['2026-11-10T20:00:00+08:00'] }), NINE_PM)).toEqual([])
  })

  it('respects the per-game switch and a skipped game', () => {
    const t = [task('Daily activity')]
    expect(whatsLeft([game({ tasks: t, notify_nudge: false })], ticks({}), NINE_PM)).toEqual([])
    expect(whatsLeft([game({ tasks: t, skipped_until: '2026-11-13T04:00:00+08:00' })], ticks({}), NINE_PM)).toEqual([])
  })
})

describe('evening nudge', () => {
  const games = [game({ tasks: [task('Daily activity')] })]

  it('is not sent before the chosen time', () => {
    expect(nudgeReminder(settings, games, ticks({}), at('2026-11-12T20:59:00+08:00'))).toBeNull()
  })

  it('is sent from 9:00 PM, and a late run can still send it for 3 hours', () => {
    const first = nudgeReminder(settings, games, ticks({}), NINE_PM)!
    const late = nudgeReminder(settings, games, ticks({}), at('2026-11-12T23:59:00+08:00'))!
    expect(first.text).toContain('**Wuthering Waves**')
    expect(first.text).toContain('- Daily activity')
    expect(late.key).toBe(first.key) // same key → sent once per evening
    expect(nudgeReminder(settings, games, ticks({}), at('2026-11-13T00:00:00+08:00'))).toBeNull()
  })

  it('has a new key the next evening', () => {
    const a = nudgeReminder(settings, games, ticks({}), NINE_PM)!
    const b = nudgeReminder(settings, games, ticks({}), at('2026-11-13T21:00:00+08:00'))!
    expect(b.key).not.toBe(a.key)
  })

  it('is not sent when nothing is left or when it is switched off', () => {
    expect(nudgeReminder(settings, games, ticks({ 'Daily activity': ['2026-11-12T10:00:00+08:00'] }), NINE_PM)).toBeNull()
    expect(nudgeReminder({ ...settings, nudge_enabled: false }, games, ticks({}), NINE_PM)).toBeNull()
  })

  it('uses the user timezone for the nudge time', () => {
    const tokyo = { ...settings, timezone: 'Asia/Tokyo' } // 9 PM Tokyo = 8 PM Manila
    expect(nudgeReminder(tokyo, games, ticks({}), at('2026-11-12T20:00:00+08:00'))).not.toBeNull()
  })
})

describe('quiet hours', () => {
  const quiet = { ...settings, quiet_start: '23:00:00', quiet_end: '07:00:00' } // 11 PM to 7 AM, across midnight

  it('are off when no times are set', () => {
    expect(inQuietHours(settings, at('2026-11-13T02:00:00+08:00'))).toBe(false)
    expect(inQuietHours({ ...settings, quiet_start: '23:00', quiet_end: null }, at('2026-11-13T02:00:00+08:00'))).toBe(false)
  })

  it('cover the night across midnight, and stop at the end time', () => {
    expect(inQuietHours(quiet, at('2026-11-12T22:59:00+08:00'))).toBe(false)
    expect(inQuietHours(quiet, at('2026-11-12T23:00:00+08:00'))).toBe(true)
    expect(inQuietHours(quiet, at('2026-11-13T02:00:00+08:00'))).toBe(true)
    expect(inQuietHours(quiet, at('2026-11-13T06:59:00+08:00'))).toBe(true)
    expect(inQuietHours(quiet, at('2026-11-13T07:00:00+08:00'))).toBe(false)
    expect(inQuietHours(quiet, at('2026-11-13T15:00:00+08:00'))).toBe(false)
  })

  it('also work for a window inside one day', () => {
    const work = { ...settings, quiet_start: '09:00', quiet_end: '17:00' }
    expect(inQuietHours(work, at('2026-11-12T08:59:00+08:00'))).toBe(false)
    expect(inQuietHours(work, at('2026-11-12T12:00:00+08:00'))).toBe(true)
    expect(inQuietHours(work, at('2026-11-12T17:00:00+08:00'))).toBe(false)
  })

  it('hold a stamina ping during the night and send it in the morning', () => {
    // Waveplates fill at 2:00 AM
    const g = game({ stamina_meters: [waveplates(230, '2026-11-13T01:00:00+08:00')] })
    expect(buildReminders(quiet, [g], ticks({}), at('2026-11-13T02:00:00+08:00'))).toEqual([])
    const morning = buildReminders(quiet, [g], ticks({}), at('2026-11-13T07:00:00+08:00'))
    expect(morning.map((r) => r.kind)).toEqual(['stamina'])
    expect(morning[0].text).toContain('Waveplates are full (240/240)')
  })

  it('do not hold the evening nudge', () => {
    const early = { ...settings, quiet_start: '20:00', quiet_end: '07:00' }
    const g = game({ tasks: [task('Daily activity')] })
    expect(buildReminders(early, [g], ticks({}), NINE_PM).map((r) => r.kind)).toEqual(['nudge'])
  })
})

describe('event reminders', () => {
  // Ends Nov 20, 3:59 AM. With 2 days' notice the reminder is due from Nov 18, 3:59 AM.
  const event = (extra: Partial<ReminderEvent> = {}): ReminderEvent => ({
    id: 'e1', game_id: 'g1', name: 'Overdash Club', starts_at: null, ends_at: '2026-11-20T03:59:00+08:00',
    note: null, remind: true, completed_at: null, ...extra,
  })
  const games = [game()]
  const twoDays = { ...settings, event_reminder_days: 2 }
  const BEFORE = at('2026-11-18T03:00:00+08:00')
  const DUE = at('2026-11-18T04:00:00+08:00')

  it('stays quiet until 2 days before the end, then reminds once with the same key', () => {
    expect(eventReminders(twoDays, games, [event()], BEFORE)).toEqual([])
    const [first] = eventReminders(twoDays, games, [event()], DUE)
    const [later] = eventReminders(twoDays, games, [event()], at('2026-11-19T20:00:00+08:00'))
    expect(first.kind).toBe('event')
    expect(first.text).toContain('**Wuthering Waves**: Overdash Club ends')
    expect(later.key).toBe(first.key)
  })

  it('includes the progress note', () => {
    const [r] = eventReminders(twoDays, games, [event({ note: '3 of 5 stages' })], DUE)
    expect(r.text).toContain('Progress: 3 of 5 stages')
  })

  it('uses the number of days from settings; 0 turns it off', () => {
    expect(eventReminders({ ...settings, event_reminder_days: 5 }, games, [event()], at('2026-11-15T04:00:00+08:00'))).toHaveLength(1)
    expect(eventReminders({ ...settings, event_reminder_days: 0 }, games, [event()], DUE)).toEqual([])
  })

  it('skips events that are done, ended, not started, or have reminders off', () => {
    expect(eventReminders(twoDays, games, [event({ completed_at: '2026-11-17T10:00:00+08:00' })], DUE)).toEqual([])
    expect(eventReminders(twoDays, games, [event()], at('2026-11-20T04:00:00+08:00'))).toEqual([])
    expect(eventReminders(twoDays, games, [event({ starts_at: '2026-11-19T10:00:00+08:00' })], DUE)).toEqual([])
    expect(eventReminders(twoDays, games, [event({ remind: false })], DUE)).toEqual([])
  })

  it('respects the per-game Events switch', () => {
    expect(eventReminders(twoDays, [game({ notify_events: false })], [event()], DUE)).toEqual([])
  })

  it('gets a new key when the end date is moved', () => {
    const [a] = eventReminders(twoDays, games, [event()], DUE)
    const [b] = eventReminders(twoDays, games, [event({ ends_at: '2026-11-20T10:00:00+08:00' })], at('2026-11-18T12:00:00+08:00'))
    expect(b.key).not.toBe(a.key)
  })

  it('is held during quiet hours, like stamina pings', () => {
    const quiet = { ...twoDays, quiet_start: '23:00', quiet_end: '07:00' }
    expect(buildReminders(quiet, games, ticks({}), DUE, [event()])).toEqual([])
    expect(buildReminders(quiet, games, ticks({}), at('2026-11-18T07:00:00+08:00'), [event()]).map((r) => r.kind)).toEqual(['event'])
  })

  it('adds events ending within 24 hours to the evening nudge', () => {
    const soon = event({ ends_at: '2026-11-13T03:59:00+08:00' })
    const [g] = whatsLeft(games, ticks({}), NINE_PM, [soon, event()])
    expect(g.events).toEqual([{ name: 'Overdash Club', endsAt: at('2026-11-13T03:59:00+08:00') }])
    expect(nudgeReminder(settings, games, ticks({}), NINE_PM, [soon])!.text).toContain('- Event: Overdash Club ends')
  })
})

describe('putting it together', () => {
  it('returns stamina pings and the nudge in one list', () => {
    const g = game({ tasks: [task('Daily activity')], stamina_meters: [waveplates(240, '2026-11-12T12:00:00+08:00')] })
    expect(buildReminders(settings, [g], ticks({}), NINE_PM).map((r) => r.kind)).toEqual(['stamina', 'nudge'])
  })

  it('groups reminders into Discord messages under the size limit', () => {
    const r = (key: string, len: number) => ({ kind: 'stamina' as const, key, text: 'x'.repeat(len) })
    const messages = toMessages([r('a', 800), r('b', 800), r('c', 800), r('d', 3000)])
    expect(messages.map((m) => m.keys)).toEqual([['a', 'b'], ['c'], ['d']])
    expect(messages.every((m) => m.content.length <= 1900)).toBe(true)
  })
})
