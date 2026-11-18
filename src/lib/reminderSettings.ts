// THM-10: one shared copy of the Reminders page's settings (shared.ts), so the page opens at once after
// the first visit; it is refreshed when the page opens, every five minutes while open, and on focus.
import { createShared } from './shared'
import { supabase } from './supabase'

export type Settings = {
  user_id: string
  timezone: string
  nudge_enabled: boolean
  nudge_time: string
  quiet_start: string | null
  quiet_end: string | null
  work_start: string | null
  work_end: string | null
  work_days: number[]
  event_reminder_days: number
  last_reminder_run_at: string | null
}

export type GameSwitches = { id: string; name: string; preset_id: string | null; icon_path: string | null; notify_nudge: boolean; notify_stamina: boolean; notify_events: boolean }

const SETTINGS_COLUMNS = 'user_id, timezone, nudge_enabled, nudge_time, quiet_start, quiet_end, work_start, work_end, work_days, event_reminder_days, last_reminder_run_at'

async function loadReminderSettings() {
  const [settingsRes, gamesRes] = await Promise.all([
    supabase.from('user_settings').select(SETTINGS_COLUMNS).maybeSingle(),
    supabase.from('games').select('id, name, preset_id, icon_path, notify_nudge, notify_stamina, notify_events').order('created_at'),
  ])
  if (settingsRes.error) throw settingsRes.error
  if (gamesRes.error) throw gamesRes.error
  return { settings: settingsRes.data as Settings | null, games: gamesRes.data as GameSwitches[] }
}

export const reminderData = createShared(loadReminderSettings)
