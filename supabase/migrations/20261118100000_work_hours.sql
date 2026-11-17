-- SUP-4: work hours. Like quiet hours, stamina pings and event reminders wait until the window ends.
-- Before quiet or work hours start, a meter that would fill during them is pinged early (reminder function).
--
-- A window belongs to the day it starts on (a night shift from 22:00 to 06:00 starting on a Friday
-- counts as Friday). work_days lists those days: 0 = Sunday ... 6 = Saturday, the same numbering as
-- games.weekly_reset_day. The evening nudge is not affected.
--
-- user_settings already has row-level security ("Owner manages own settings") and table-wide grants,
-- so the new columns are covered without changes.

alter table public.user_settings
  add column work_start time,                                         -- both null = no work hours
  add column work_end   time,
  add column work_days  smallint[] not null default '{1,2,3,4,5}'     -- Monday to Friday
    constraint user_settings_work_days_check check (work_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]);
