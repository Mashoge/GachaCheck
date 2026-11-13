-- user_events: one list of events per user (step 3a of the collector work).
-- It joins a user's own events with the shared catalog events that apply to their games,
-- already converted to real moments for their server and carrying their own marks.
-- The Events page, the Today page and the reminder job all read this one view.
--
-- Purely additive: one view and two grants. No table or row changes.
-- The view runs with the caller's own permissions (security_invoker), so the row-level
-- security rules on the underlying tables still decide who sees what.

-- The view matches a user's own event to a catalog event by normalised name,
-- so signed-in users need to be able to run the (pure) name function.
grant execute on function public.catalog_name_key(text) to authenticated;

create view public.user_events
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
-- A user's own entry for an event the catalog also has: same game, same name, ends within a day
dup as (
  select own.id as own_id, cat.catalog_event_id, own.completed_at
  from own
  join cat
    on cat.game_id = own.game_id
   and cat.name_key = own.name_key
   and abs(extract(epoch from (own.ends_at - cat.ends_at))) <= 86400
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

comment on view public.user_events is
  'Each user''s events: their own plus the shared catalog events for their games, as real moments with their own marks. Read-only.';

-- Least privilege: read-only, signed-in users and the server role. Logged-out visitors get nothing.
revoke all on public.user_events from public, anon, authenticated, service_role;
grant select on public.user_events to authenticated, service_role;
