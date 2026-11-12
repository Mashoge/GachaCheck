-- Events: an optional start (for upcoming events and the timeline) and a "finished" mark.

alter table public.events
  add column starts_at    timestamptz,  -- null = already running
  add column completed_at timestamptz;  -- set when you mark the event as done; stops its reminders
