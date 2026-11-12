-- Reminder settings: quiet hours and a "last checked" time for the Reminders page.

alter table public.user_settings
  add column quiet_start          time,         -- stamina pings wait between quiet_start and quiet_end
  add column quiet_end            time,         -- (both null = no quiet hours)
  add column last_reminder_run_at timestamptz;  -- set by the reminder function on every run
