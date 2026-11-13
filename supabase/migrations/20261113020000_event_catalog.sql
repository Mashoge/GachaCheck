-- Shared event catalog (step 1 of the collector work).
-- Shared event catalog: events collected from official sources are stored once,
-- and each user keeps only their own marks (done, hidden, reminder, note).
-- Purely additive: no existing table or row is changed, except one new column on user_settings.
-- It creates no admin and grants nothing to logged-out visitors.

-- ============================================================
-- app_admins: who may review the shared catalog
-- ============================================================
create table public.app_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ============================================================
-- source_articles: every official article the collector has read
-- ============================================================
create table public.source_articles (
  id              bigint generated always as identity primary key,
  game            text not null check (game ~ '^[a-z0-9_-]{1,20}$'),      -- matches games.preset_id, e.g. 'wuwa'
  source          text not null check (source ~ '^[a-z0-9_]{1,40}$'),     -- e.g. 'wuwa_official_site'
  external_id     text not null check (char_length(external_id) between 1 and 80),  -- the publisher's own article ID
  title           text not null check (char_length(title) between 1 and 300),
  url             text check (url ~ '^https://'),
  article_kind    text not null default 'other'
    check (article_kind in ('patch_notes', 'maintenance', 'events_notice', 'banner_notice', 'event_preview', 'endgame_notice', 'feed', 'other')),
  published_at    timestamptz,                    -- when the publisher released it (a real moment)
  content_hash    text,                           -- e.g. the file's ETag; a new value means the article was edited
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  last_changed_at timestamptz,                    -- last time content_hash changed
  unique (source, external_id)                    -- discovery uses this ID, never the position in the index
);
create index source_articles_game_published_idx on public.source_articles (game, published_at desc);

-- ============================================================
-- catalog_events: one row per real event, shared by everyone
-- ============================================================
create table public.catalog_events (
  id                 uuid primary key default gen_random_uuid(),
  game               text not null check (game ~ '^[a-z0-9_-]{1,20}$'),
  version            text not null default '' check (char_length(version) <= 20),   -- e.g. '3.8'; '' when the source has none
  kind               text not null
    check (kind in ('event', 'web_event', 'banner', 'endgame_cycle')),
  server_scope       text not null default 'all' check (server_scope ~ '^[a-z0-9_-]{1,20}$'),  -- 'all' or a games.server value
  name               text not null check (char_length(name) between 1 and 120),
  name_key           text not null check (char_length(name_key) between 1 and 120), -- normalised name, used for matching
  -- Tells apart repeats that share a name inside one version, e.g. two endgame cycles.
  -- Taken from something the publisher does not edit later: a cycle number or label, else the cycle's start date.
  occurrence_key     text not null default '' check (occurrence_key ~ '^[a-z0-9:_-]{0,40}$'),

  -- Dates are kept as the clock times the publisher printed.
  starts_local       timestamp,
  ends_local         timestamp,
  time_basis         text not null default 'server_local'
    check (time_basis in ('server_local', 'fixed_offset')),  -- server_local = each server's own clock
  utc_offset_minutes smallint check (utc_offset_minutes between -720 and 840),  -- e.g. 480 for "(UTC+8)"
  start_rule         text not null default 'exact'
    check (start_rule in ('exact', 'after_update', 'unknown')),

  official_url       text check (official_url ~ '^https://'),  -- shown to users, e.g. a web event's page
  task_preset_key    text,                                     -- endgame cycles: which preset task these dates belong to
  derived_from       uuid references public.catalog_events (id) on delete set null,  -- e.g. trial dates inferred from a banner

  status             text not null default 'needs_review'
    check (status in ('confirmed', 'needs_review', 'rejected')),
  review_note        text check (char_length(review_note) <= 300),
  locked_at          timestamptz,     -- set when a person edits the row; the collector then never overwrites it
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint catalog_events_offset_check
    check ((time_basis = 'fixed_offset') = (utc_offset_minutes is not null)),
  constraint catalog_events_order_check
    check (starts_local is null or ends_local is null or ends_local > starts_local),
  constraint catalog_events_exact_start_check
    check (start_rule <> 'exact' or starts_local is not null),
  constraint catalog_events_confirmed_check
    check (status <> 'confirmed' or ends_local is not null),      -- nothing is shown without an end date
  constraint catalog_events_endgame_check
    check ((kind = 'endgame_cycle') = (task_preset_key is not null)),
  constraint catalog_events_endgame_occurrence_check
    check (kind <> 'endgame_cycle' or occurrence_key <> ''),      -- every cycle must say which one it is
  constraint catalog_events_not_self check (derived_from is null or derived_from <> id)
);

-- The identity of an event: the same event from two articles is stored once,
-- while two cycles of one endgame mode in the same version stay separate.
create unique index catalog_events_identity_idx
  on public.catalog_events (game, version, kind, server_scope, name_key, occurrence_key);
create index catalog_events_game_ends_idx on public.catalog_events (game, ends_local);
create index catalog_events_review_idx on public.catalog_events (status) where status = 'needs_review';

-- ============================================================
-- catalog_event_sources: what each article said about each event
-- (many articles per event, many events per article)
-- ============================================================
create table public.catalog_event_sources (
  event_id                    uuid not null references public.catalog_events (id) on delete cascade,
  article_id                  bigint not null references public.source_articles (id) on delete cascade,
  -- The collector's stable key for this item inside the article. An edited date keeps the same key,
  -- so the ingest function finds the existing event instead of adding a second one.
  observed_key                text not null check (char_length(observed_key) between 1 and 200),
  observed_name               text not null check (char_length(observed_name) between 1 and 200),
  observed_starts_local       timestamp,
  observed_ends_local         timestamp,
  observed_time_basis         text not null check (observed_time_basis in ('server_local', 'fixed_offset')),
  observed_utc_offset_minutes smallint check (observed_utc_offset_minutes between -720 and 840),
  observed_start_rule         text not null check (observed_start_rule in ('exact', 'after_update', 'unknown')),
  raw_text                    text check (char_length(raw_text) <= 500),   -- the line the dates were read from
  conflict                    boolean not null default false,              -- disagrees with the catalog row
  missing_since               timestamptz,                                 -- the article no longer lists this event
  first_seen_at               timestamptz not null default now(),
  last_seen_at                timestamptz not null default now(),
  primary key (event_id, article_id),
  unique (article_id, observed_key),
  constraint catalog_event_sources_offset_check
    check ((observed_time_basis = 'fixed_offset') = (observed_utc_offset_minutes is not null)),
  constraint catalog_event_sources_order_check
    check (observed_starts_local is null or observed_ends_local is null or observed_ends_local > observed_starts_local),
  constraint catalog_event_sources_exact_start_check
    check (observed_start_rule <> 'exact' or observed_starts_local is not null)
);
create index catalog_event_sources_conflict_idx on public.catalog_event_sources (event_id) where conflict;

-- ============================================================
-- user_event_state: each user's own marks on a catalog event
-- ============================================================
create table public.user_event_state (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id     uuid not null references public.catalog_events (id) on delete cascade,
  completed_at timestamptz,
  hidden       boolean not null default false,
  remind       boolean not null default true,
  note         text check (char_length(note) <= 200),
  updated_at   timestamptz not null default now(),
  primary key (user_id, event_id)
);
create index user_event_state_event_idx on public.user_event_state (event_id);

-- One switch to hide every web event at once (each one can also be hidden on its own)
alter table public.user_settings
  add column show_web_events boolean not null default true;

-- ============================================================
-- Edit locks: a person's edit is never overwritten by the collector
-- ============================================================
create function public.catalog_events_touch() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  who       text := (select auth.role());
  -- The whole row, minus the two columns this trigger manages itself
  old_row   jsonb := to_jsonb(old) - 'updated_at' - 'locked_at';
  new_row   jsonb := to_jsonb(new) - 'updated_at' - 'locked_at';
begin
  new.updated_at := now();

  if who = 'authenticated' then
    -- A signed-in admin
    if old.locked_at is not null and new.locked_at is null then
      -- Unlocking hands the row back to the collector. It must be its own change:
      -- an edit made in the same update would lose its protection straight away.
      if new_row is distinct from old_row then
        raise exception 'unlock catalog event % on its own, without other edits in the same update', old.id
          using errcode = 'P0001';
      end if;
    else
      new.locked_at := now();   -- any other admin edit locks the row
    end if;

  elsif who = 'service_role' and old.locked_at is not null then
    -- The ingest function. It must check locked_at itself and record a conflict instead.
    -- This stops the write if that check is ever missing. Every column is protected,
    -- including the identity fields, the review note and the lock itself.
    if new_row is distinct from old_row or new.locked_at is distinct from old.locked_at then
      raise exception 'catalog event % is locked by a reviewer; record a conflict instead of overwriting it', old.id
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

create trigger catalog_events_touch
  before update on public.catalog_events
  for each row execute function public.catalog_events_touch();

-- ============================================================
-- Row-level security
-- ============================================================
alter table public.app_admins            enable row level security;
alter table public.source_articles       enable row level security;
alter table public.catalog_events        enable row level security;
alter table public.catalog_event_sources enable row level security;
alter table public.user_event_state      enable row level security;

create policy "Users see whether they are an admin" on public.app_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Everyone signed in sees confirmed events; admins also see the ones waiting for review
create policy "Signed-in users read confirmed events" on public.catalog_events
  for select to authenticated
  using (
    status = 'confirmed'
    or exists (select 1 from public.app_admins a where a.user_id = (select auth.uid()))
  );

create policy "Admins review events" on public.catalog_events
  for update to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.app_admins a where a.user_id = (select auth.uid())));

create policy "Admins read source articles" on public.source_articles
  for select to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = (select auth.uid())));

create policy "Admins read source observations" on public.catalog_event_sources
  for select to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = (select auth.uid())));

create policy "Owner manages own event marks" on public.user_event_state
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ============================================================
-- Table access (least privilege)
-- Start from nothing, whatever the project's default privileges are, then grant only what is needed.
-- anon (logged-out visitors) gets nothing.
-- ============================================================
revoke all on public.app_admins, public.source_articles, public.catalog_events,
              public.catalog_event_sources, public.user_event_state
  from public, anon, authenticated, service_role;
revoke all on sequence public.source_articles_id_seq from public, anon, authenticated, service_role;
revoke all on function public.catalog_events_touch() from public, anon, authenticated, service_role;

-- Signed-in users: read (row-level security decides which rows), and manage their own marks
grant select on public.app_admins, public.source_articles, public.catalog_event_sources, public.catalog_events
  to authenticated;
grant select, insert, update, delete on public.user_event_state to authenticated;

-- Admins (row-level security limits this to them) may change only the review fields, the dates and the lock.
-- Identity columns stay with the collector.
grant update (name, starts_local, ends_local, time_basis, utc_offset_minutes, start_rule,
              official_url, status, review_note, locked_at)
  on public.catalog_events to authenticated;

-- The ingest function (server side only). No delete: source history is kept.
-- An event the collector should drop is marked 'rejected'; an observation that
-- disappears from its article gets missing_since.
grant select, insert, update
  on public.source_articles, public.catalog_events, public.catalog_event_sources
  to service_role;
grant select on public.app_admins, public.user_event_state to service_role;

-- No admin is created here. See BOOTSTRAP_admin.sql: an admin is added by hand, by email, after checking the account.
