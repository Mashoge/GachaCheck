-- user_events: also treat a renamed entry as a duplicate.
--
-- Before: a user's own event was hidden only when its name matched a catalog event exactly.
-- So an own "Lahai-Roi Blocks" stayed listed next to the official "Lahai-Roi Blocks: Turnabout".
--
-- Now a duplicate is, for the same game and with ends within a day of each other:
--   1. an exact name match (as before), or
--   2. one name being the start of the other, on a whole-word boundary,
--      but only when the own event has no exact match and exactly one such candidate.
--      If two official events could both be meant, nothing is hidden.
--
-- Only the "dup" step changes. Columns, permissions and everything else stay the same,
-- so this replaces the view in place and existing grants are kept.

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
      when c.starts_local is null then null
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
    coalesce(s.hidden, false)         as hidden
  from public.games g
  join public.catalog_events c
    on c.game = g.preset_id
   and c.server_scope in ('all', g.server)
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
  null::uuid                            as own_event_id
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
  own.id
from own
where not exists (select 1 from dup d where d.own_id = own.id);
