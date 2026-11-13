-- catalog_versions: when each game version went live.
--
-- Why: many events start "after the update". Patch Notes are posted before the update
-- (NTE about two days early, WuWa about an hour), so those events had no start date and
-- were shown as already running too soon. The update ends at one moment worldwide, so one
-- row per version gives every "after update" event its real start, on every server.
-- Step 7's "a new version is overdue" warning will read this table too.
--
-- Changes:
--   1. New table catalog_versions (shared, written only by the ingest function).
--   2. New function catalog_ingest_versions; catalog_ingest now calls it after the events.
--      An article may carry  version_release: { version, released_at }  (optional).
--   3. The user_events view uses the version's go-live moment as the start of an
--      "after update" event that has no start date of its own.
-- No existing rows change. Payloads without version_release behave exactly as before.

-- ============================================================
-- 1. The table
-- ============================================================
create table public.catalog_versions (
  game              text not null check (game ~ '^[a-z0-9_-]{1,20}$'),           -- matches games.preset_id
  version           text not null check (char_length(version) between 1 and 20),  -- e.g. '1.5'
  released_at       timestamptz not null,   -- when the version went live: the end of the update maintenance
  source_article_id bigint references public.source_articles (id) on delete set null,  -- the article that said so
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (game, version)
);

comment on table public.catalog_versions is
  'When each game version went live. Gives "after update" events their start. Written only by the ingest function.';

alter table public.catalog_versions enable row level security;

-- Public schedule information, no personal data: any signed-in user may read it
-- (the user_events view runs with the reader''s permissions, so it needs this).
create policy "Signed-in users read version dates" on public.catalog_versions
  for select to authenticated
  using (true);

-- Least privilege: logged-out visitors get nothing; signed-in users only read;
-- the ingest function reads and writes, and never deletes.
revoke all on public.catalog_versions from public, anon, authenticated, service_role;
grant select on public.catalog_versions to authenticated;
grant select, insert, update on public.catalog_versions to service_role;

-- ============================================================
-- 2. Ingest
-- ============================================================
-- Saves the go-live moments a run reports. The newest report wins: if a later run says a
-- different time (for example an extended maintenance), the row is updated.
create function public.catalog_ingest_versions(p jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  art       jsonb;
  v_version text;
  v_at      timestamptz;
  v_art_id  bigint;
  cur       public.catalog_versions;
  v_action  text;
  counts    jsonb := jsonb_build_object('created', 0, 'updated', 0, 'unchanged', 0);
  items     jsonb := '[]'::jsonb;
begin
  for art in select value from jsonb_array_elements(p -> 'articles') loop
    continue when jsonb_typeof(art -> 'version_release') is distinct from 'object';

    v_version := art -> 'version_release' ->> 'version';
    v_at      := (art -> 'version_release' ->> 'released_at')::timestamptz;

    select id into v_art_id
      from public.source_articles
     where source = p ->> 'source' and external_id = art ->> 'external_id';

    select * into cur from public.catalog_versions where game = p ->> 'game' and version = v_version;

    if not found then
      insert into public.catalog_versions (game, version, released_at, source_article_id)
      values (p ->> 'game', v_version, v_at, v_art_id);
      v_action := 'created';
    elsif cur.released_at = v_at then
      v_action := 'unchanged';
    else
      update public.catalog_versions
         set released_at = v_at, source_article_id = v_art_id, updated_at = now()
       where game = p ->> 'game' and version = v_version;
      v_action := 'updated';
    end if;

    counts := jsonb_set(counts, array[v_action], to_jsonb((counts ->> v_action)::int + 1));
    items  := items || jsonb_build_object('version', v_version, 'released_at', v_at, 'action', v_action);
  end loop;

  return jsonb_build_object('counts', counts, 'items', items);
end;
$$;

-- The entry point, unchanged except that it now also saves version dates,
-- inside the same rolled-back block on a dry run.
create or replace function public.catalog_ingest(p jsonb, p_dry boolean default false) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result   jsonb;
  versions jsonb;
begin
  if not p_dry then
    result   := public.catalog_ingest_apply(p);
    versions := public.catalog_ingest_versions(p);
    return result || jsonb_build_object('versions', versions -> 'counts', 'version_items', versions -> 'items', 'dry_run', false);
  end if;

  begin
    result   := public.catalog_ingest_apply(p);
    versions := public.catalog_ingest_versions(p);
    raise exception using errcode = 'GC001', message = 'dry run: rolling back';
  exception when sqlstate 'GC001' then
    null;   -- every write in this block is undone; result and versions keep their values
  end;
  return result || jsonb_build_object('versions', versions -> 'counts', 'version_items', versions -> 'items', 'dry_run', true);
end;
$$;

revoke all on function public.catalog_ingest_versions(jsonb) from public, anon, authenticated;
grant execute on function public.catalog_ingest_versions(jsonb) to service_role;
-- catalog_ingest keeps its grants (create or replace does not reset them); restated for clarity
revoke all on function public.catalog_ingest(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.catalog_ingest(jsonb, boolean) to service_role;

-- ============================================================
-- 3. The view: "after update" events start when their version went live
-- Only the start of cat changes; columns, permissions and the duplicate rule stay the same.
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
    coalesce(s.hidden, false)         as hidden
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
