-- EVT-11: your own picture on an event card (for example a screenshot of the event's banner).
--
-- Decided Nov 19, 2026: the app gathers facts automatically (names, dates, links to official pages),
-- never pictures. The official patch notes have no per-event banners, and copying the art from guide
-- or fan sites would mean using the publishers' art without permission, so pictures come only from you.
--
-- Like character pictures and game icons (LTR-8), the file is your own upload in the private
-- character-art bucket, in your own folder (<user id>/<game id>/event-<id>.webp), readable only by you
-- through short-lived signed links, shrunk in the browser first (at most 1 MB, WebP or JPEG).
-- The bucket and its owner-only policies already exist (character_images migration).
--
-- Changes:
--   1. picture_path on public.events (your own events).
--   2. picture_path on public.user_event_state (your own marks on a shared official event, next to your
--      note and done mark), so the shared catalog itself never holds anyone's picture.
--   3. The user_events view gains a last column, picture_path. Nothing else in it changes.
-- No existing rows change.

-- ============================================================
-- 1. Your own events
-- ============================================================
alter table public.events
  add column picture_path text
    constraint events_picture_path_check
    check (picture_path is null
           or (picture_path like user_id::text || '/' || game_id::text || '/event-%' and char_length(picture_path) <= 200));

comment on column public.events.picture_path is
  'EVT-11: your own picture for this event, in the character-art bucket (your folder only).';

-- ============================================================
-- 2. Your marks on an official event
-- ============================================================
-- The game's folder is not known from this table alone, so the rule is: your folder, an event file.
alter table public.user_event_state
  add column picture_path text
    constraint user_event_state_picture_path_check
    check (picture_path is null
           or (picture_path like user_id::text || '/%/event-%' and char_length(picture_path) <= 200));

comment on column public.user_event_state.picture_path is
  'EVT-11: your own picture for this official event, in the character-art bucket (your folder only).';

-- ============================================================
-- 3. The view: the same as before (catalog_versions migration) plus picture_path as the last column
-- ============================================================
create or replace view public.user_events
with (security_invoker = true)
as
with cat as (
  -- Confirmed catalog events for each of a user's games, with times turned into real moments
  select
    c.id                as catalog_event_id,
    g.user_id,
    g.id                as game_id,
    c.name,
    c.name_key,
    c.kind,
    c.official_url,
    case
      -- No printed start: an "after update" event starts when its version went live (if known)
      when c.starts_local is null then case when c.start_rule = 'after_update' then v.released_at end
      when c.time_basis = 'server_local' then c.starts_local at time zone g.timezone
      else (c.starts_local - make_interval(mins => c.utc_offset_minutes)) at time zone 'UTC'
    end                 as starts_at,
    case
      when c.time_basis = 'server_local' then c.ends_local at time zone g.timezone
      else (c.ends_local - make_interval(mins => c.utc_offset_minutes)) at time zone 'UTC'
    end                 as ends_at,
    s.user_id is not null             as has_state,
    s.completed_at,
    s.note,
    coalesce(s.remind, true)          as remind,
    coalesce(s.hidden, false)         as hidden,
    s.picture_path
  from public.games g
  join public.catalog_events c
    on c.game = g.preset_id
   and c.server_scope in ('all', g.server)
  left join public.catalog_versions v on v.game = c.game and v.version = c.version
  left join public.user_settings us on us.user_id = g.user_id
  left join public.user_event_state s on s.event_id = c.id and s.user_id = g.user_id
  where c.status = 'confirmed'
    and c.kind in ('event', 'web_event')          -- banners and endgame cycles are not listed as events
    and c.ends_local is not null
    and (c.kind <> 'web_event' or coalesce(us.show_web_events, true))
),
own as (
  select e.*, public.catalog_name_key(e.name) as name_key
  from public.events e
  where not e.hidden
),
-- Possible pairs: same game, ends within a day, and the names are equal
-- or one is the start of the other (whole words only, shorter name at least 4 characters)
cand as (
  select
    own.id as own_id,
    cat.catalog_event_id,
    own.completed_at,
    cat.name_key = own.name_key                                           as exact,
    count(*) over (partition by own.id)                                   as candidates,
    bool_or(cat.name_key = own.name_key) over (partition by own.id)       as has_exact
  from own
  join cat
    on cat.game_id = own.game_id
   and abs(extract(epoch from (own.ends_at - cat.ends_at))) <= 86400
   and (
        cat.name_key = own.name_key
     or (length(own.name_key) >= 4 and left(cat.name_key, length(own.name_key) + 1) = own.name_key || ' ')
     or (length(cat.name_key) >= 4 and left(own.name_key, length(cat.name_key) + 1) = cat.name_key || ' ')
   )
),
-- A user's own entry for an event the catalog also has:
-- an exact match always counts; a partial match counts only when it is the single candidate
dup as (
  select own_id, catalog_event_id, completed_at
  from cand
  where exact or (not has_exact and candidates = 1)
)
-- Catalog events (unless the user hid them)
select
  'cat:' || cat.catalog_event_id::text  as id,
  'catalog'::text                       as origin,
  cat.user_id,
  cat.game_id,
  cat.name,
  cat.starts_at,
  cat.ends_at,
  cat.note,
  cat.remind,
  -- Until the user touches the catalog event, a done mark on their own duplicate carries over
  case when cat.has_state then cat.completed_at
       else (select max(d.completed_at) from dup d where d.catalog_event_id = cat.catalog_event_id)
  end                                   as completed_at,
  'catalog'::text                       as source,
  cat.kind,
  cat.official_url,
  cat.catalog_event_id,
  null::uuid                            as own_event_id,
  cat.picture_path
from cat
where not cat.hidden

union all

-- The user's own events, except duplicates of a catalog event
select
  own.id::text,
  'own'::text,
  own.user_id,
  own.game_id,
  own.name,
  own.starts_at,
  own.ends_at,
  own.note,
  own.remind,
  own.completed_at,
  own.source,
  'event'::text,
  null::text,
  null::uuid,
  own.id,
  own.picture_path
from own
where not exists (select 1 from dup d where d.own_id = own.id);
