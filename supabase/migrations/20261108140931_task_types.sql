-- Task types (TSK-1, 4, 5, 6, 9): categories, reset rules, hide/optional flags,
-- weekly targets, and preset keys so preset updates can sync to existing games.

-- ---------- tasks ----------
alter table public.tasks drop constraint tasks_frequency_check;

alter table public.tasks
  add constraint tasks_frequency_check
    check (frequency in ('daily', 'weekly', 'monthly', 'interval', 'dated', 'none')),
  add column category      text not null default 'routine'
    check (category in ('routine', 'endgame', 'goal')),
  add column preset_key    text,                     -- null = a task you added yourself
  add column hidden        boolean not null default false,
  add column optional      boolean not null default false,  -- e.g. subscription claims
  add column note          text check (char_length(note) <= 200),
  add column weekly_target smallint check (weekly_target between 1 and 50),
  add column monthly_day   smallint check (monthly_day between 1 and 28),
  add column cycle_anchor  date,                     -- server-local start date of any cycle (interval)
  add column cycle_days    smallint check (cycle_days between 1 and 365),
  add column cycle_ends_at timestamp,                -- server-local end of the current cycle (dated)
  add column due_at        timestamptz;              -- optional deadline for goals

-- Each reset rule must have the fields it needs
alter table public.tasks add constraint tasks_rule_fields_check check (
  (frequency <> 'monthly'  or monthly_day is not null) and
  (frequency <> 'interval' or (cycle_anchor is not null and cycle_days is not null))
);

-- One row per preset task per game (lets the sync find and update it)
create unique index tasks_game_preset_key_idx
  on public.tasks (game_id, preset_key) where preset_key is not null;

-- ---------- stamina_meters ----------
alter table public.stamina_meters add column preset_key text;
create unique index stamina_meters_game_preset_key_idx
  on public.stamina_meters (game_id, preset_key) where preset_key is not null;

-- ---------- completions ----------
-- Counted weekly targets (e.g. 3 enhanced Echo drops) add up within one period
alter table public.completions
  add column amount smallint not null default 1 check (amount between 1 and 50);