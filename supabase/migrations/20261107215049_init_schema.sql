-- GachaCheck — initial schema (SET-2)
-- Tables: user_settings, games, tasks, completions, stamina_meters, events, notify_log
-- Every row belongs to one user, and row-level security (RLS) limits access to that owner.

-- ============================================================
-- user_settings: one row per user (global reminder settings)
-- ============================================================
create table public.user_settings (
  user_id               uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  timezone              text not null default 'Asia/Manila',   -- your own timezone, for the evening nudge
  nudge_enabled         boolean not null default true,
  nudge_time            time not null default '21:00',
  event_reminder_days   smallint not null default 2 check (event_reminder_days between 0 and 14),
  reset_message_enabled boolean not null default false,        -- REM-6, off by default
  created_at            timestamptz not null default now()
);

-- ============================================================
-- games: each gacha you track
-- ============================================================
create table public.games (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 60),
  server           text,                                         -- e.g. 'Asia'
  timezone         text not null default 'Asia/Manila',          -- server's timezone for resets (UTC+8 = Asia servers)
  daily_reset_time time not null default '04:00',
  weekly_reset_day smallint not null default 1 check (weekly_reset_day between 0 and 6),  -- 0 = Sun, 1 = Mon
  notify_nudge     boolean not null default true,                -- REM-5 per-game toggles
  notify_stamina   boolean not null default true,
  notify_events    boolean not null default true,
  skipped_until    timestamptz,                                  -- TOD-7 "skip this game today"
  preset_id        text,                                         -- GAM-6, e.g. 'genshin'
  preset_version   integer,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);
create index games_user_id_idx on public.games (user_id);

-- ============================================================
-- tasks: the checklist items for each game
-- ============================================================
create table public.tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  game_id    uuid not null references public.games (id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 80),
  frequency  text not null default 'daily' check (frequency in ('daily', 'weekly')),
  sort_order integer not null default 0,
  archived   boolean not null default false,                     -- removed tasks keep their history
  created_at timestamptz not null default now()
);
create index tasks_game_id_idx on public.tasks (game_id);

-- ============================================================
-- completions: one row each time a task is ticked in a period
-- (untick = delete the row; resets need no clean-up)
-- ============================================================
create table public.completions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id      uuid not null references public.tasks (id) on delete cascade,
  period_start timestamptz not null,                             -- start of the day/week it counts for
  completed_at timestamptz not null default now(),
  unique (task_id, period_start)                                 -- can't tick the same task twice per period
);
create index completions_user_period_idx on public.completions (user_id, period_start);

-- ============================================================
-- stamina_meters: zero, one or several per game
-- (latest entered value lives on the meter; the app counts up from it)
-- ============================================================
create table public.stamina_meters (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  game_id           uuid not null references public.games (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 40),
  cap               integer not null check (cap > 0),
  minutes_per_point numeric(6, 2) not null check (minutes_per_point > 0),
  current_value     integer not null default 0 check (current_value >= 0),  -- may exceed cap (overflow)
  value_recorded_at timestamptz not null default now(),
  warn_minutes      integer not null default 20 check (warn_minutes between 0 and 1440),
  spend_presets     integer[] not null default '{}',             -- STA-4 quick "spent" buttons
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now()
);
create index stamina_meters_game_id_idx on public.stamina_meters (game_id);

-- ============================================================
-- events: limited-time events you add by hand
-- ============================================================
create table public.events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  game_id    uuid not null references public.games (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  ends_at    timestamptz not null,
  note       text check (char_length(note) <= 200),              -- EVT-5 progress note
  remind     boolean not null default true,
  created_at timestamptz not null default now()
);
create index events_user_ends_idx on public.events (user_id, ends_at);
create index events_game_id_idx on public.events (game_id);

-- ============================================================
-- notify_log: what the reminder function already sent (prevents repeats)
-- written only by the server-side function; you can read your own
-- ============================================================
create table public.notify_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('stamina', 'nudge', 'event', 'reset')),
  dedupe_key text not null unique,                               -- e.g. 'stamina:<meter id>:<full-at time>'
  sent_at    timestamptz not null default now()
);
create index notify_log_user_sent_idx on public.notify_log (user_id, sent_at desc);

-- ============================================================
-- Row-level security: only the owner can see or change their rows
-- ============================================================
alter table public.user_settings  enable row level security;
alter table public.games          enable row level security;
alter table public.tasks          enable row level security;
alter table public.completions    enable row level security;
alter table public.stamina_meters enable row level security;
alter table public.events         enable row level security;
alter table public.notify_log     enable row level security;

create policy "Owner manages own settings" on public.user_settings
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Owner manages own games" on public.games
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Owner manages own tasks" on public.tasks
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Owner manages own completions" on public.completions
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Owner manages own stamina meters" on public.stamina_meters
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Owner manages own events" on public.events
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Owner reads own notifications" on public.notify_log
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================
-- Table access for the Data API
-- ("Automatically expose new tables" is off, so grant explicitly)
-- anon (logged-out visitors) gets nothing
-- ============================================================
grant select, insert, update, delete
  on public.user_settings, public.games, public.tasks,
     public.completions, public.stamina_meters, public.events
  to authenticated;
grant select on public.notify_log to authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ============================================================
-- Create the settings row for your existing account
-- ============================================================
insert into public.user_settings (user_id)
select id from auth.users
on conflict (user_id) do nothing;