-- Scenario tests for catalog_versions (when each version went live) and its use in user_events.
--
-- Run in the Supabase SQL editor (paste the whole file, click Run) or with psql.
-- Needs: the catalog migrations applied, at least one row in public.app_admins,
-- and at least one account with a Wuthering Waves game (preset 'wuwa').
-- It uses a fake game 'zztest', source 'zztest_source', and WuWa version 'zzv' for the view checks,
-- removes all of it at the end, and finishes with a results table: every row should show pass = true.
-- If a run is interrupted, use the cleanup block at the bottom of this file.

create temp table if not exists version_results (n int, scenario text, expected text, got text, pass boolean);
truncate version_results;
grant all on version_results to public;

create or replace function pg_temp.check(n int, scenario text, expected text, got text) returns void language sql as $$
  insert into version_results values (n, scenario, expected, coalesce(got, '(nothing)'), coalesce(got, '(nothing)') = expected)
$$;

-- Calls catalog_ingest as the server role, the same way the Edge Function does
create or replace function pg_temp.ingest(p jsonb, dry boolean default false) returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  r := public.catalog_ingest(p, dry);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;

-- A one-article payload with one trusted "after update" event; release = null leaves version_release out
create or replace function pg_temp.payload(release_at text) returns jsonb language sql as $$
  select jsonb_build_object('source', 'zztest_source', 'game', 'zztest', 'articles', jsonb_build_array(
    jsonb_build_object('external_id', 'v1', 'title', 'Test patch notes', 'url', null, 'article_kind', 'patch_notes',
      'published_at', '2030-01-01T10:00:00+08:00', 'content_hash', 'h1', 'complete', true,
      'observations', jsonb_build_array(jsonb_build_object(
        'observed_key', 'event:zz-after', 'kind', 'event', 'version', '9.9', 'server_scope', 'all', 'name', 'ZZ After',
        'occurrence_key', '', 'starts_local', null, 'ends_local', '2030-02-01T03:59', 'time_basis', 'server_local',
        'utc_offset_minutes', null, 'start_rule', 'after_update', 'official_url', null, 'task_preset_key', null,
        'raw_text', 'test line', 'trusted', true)))
    || case when release_at is null then '{}'::jsonb
            else jsonb_build_object('version_release', jsonb_build_object('version', '9.9', 'released_at', release_at)) end))
$$;

create or replace function pg_temp.vcounts(r jsonb) returns text language sql as $$
  select 'created=' || (r -> 'versions' ->> 'created') || ' updated=' || (r -> 'versions' ->> 'updated')
         || ' unchanged=' || (r -> 'versions' ->> 'unchanged')
$$;

do $$
declare
  r       jsonb;
  got     text;
  v_user  uuid;
  v_game  uuid;
  v_tz    text;
  c_srv   uuid := gen_random_uuid();   -- "after update", server time
  c_fix   uuid := gen_random_uuid();   -- "after update", fixed UTC+8
  c_exact uuid := gen_random_uuid();   -- printed start
  c_nover uuid := gen_random_uuid();   -- "after update", version not known
  c_unk   uuid := gen_random_uuid();   -- start unknown (not "after update")
begin
  if exists (select 1 from public.catalog_events where game = 'zztest' or (game = 'wuwa' and version = 'zzv'))
     or exists (select 1 from public.catalog_versions where game = 'zztest' or (game = 'wuwa' and version = 'zzv'))
     or exists (select 1 from public.source_articles where source = 'zztest_source') then
    raise exception 'Leftover test rows found. Run the cleanup block at the bottom of this file first.';
  end if;
  insert into public.catalog_trust_rules (source, article_kind, kind, note)
    values ('zztest_source', 'patch_notes', 'event', 'test rule');

  -- ---------- Ingest ----------
  r := pg_temp.ingest(pg_temp.payload('2030-01-03T11:00:00+08:00'), true);
  perform pg_temp.check(1, 'dry run reports the new version', 'created=1 updated=0 unchanged=0', pg_temp.vcounts(r));
  select count(*)::text into got from public.catalog_versions where game = 'zztest';
  perform pg_temp.check(2, 'dry run saves no version', '0', got);

  r := pg_temp.ingest(pg_temp.payload('2030-01-03T11:00:00+08:00'));
  perform pg_temp.check(3, 'real run saves the version', 'created=1 updated=0 unchanged=0', pg_temp.vcounts(r));
  select (released_at = '2030-01-03T03:00:00Z')::text into got from public.catalog_versions where game = 'zztest' and version = '9.9';
  perform pg_temp.check(4, 'go-live moment stored exactly', 'true', got);
  select (v.source_article_id = a.id)::text into got
    from public.catalog_versions v join public.source_articles a on a.source = 'zztest_source' and a.external_id = 'v1'
   where v.game = 'zztest';
  perform pg_temp.check(5, 'version points to the article that reported it', 'true', got);
  perform pg_temp.check(6, 'events in the same run are saved as before', '1', (r -> 'counts' ->> 'created'));

  r := pg_temp.ingest(pg_temp.payload('2030-01-03T11:00:00+08:00'));
  perform pg_temp.check(7, 'same time again: unchanged', 'created=0 updated=0 unchanged=1', pg_temp.vcounts(r));

  r := pg_temp.ingest(pg_temp.payload('2030-01-03T12:30:00+08:00'));
  perform pg_temp.check(8, 'a new time (longer maintenance) updates it', 'created=0 updated=1 unchanged=0', pg_temp.vcounts(r));
  select (released_at = '2030-01-03T04:30:00Z')::text into got from public.catalog_versions where game = 'zztest' and version = '9.9';
  perform pg_temp.check(9, 'the stored time is the new one', 'true', got);

  r := pg_temp.ingest(pg_temp.payload(null));
  perform pg_temp.check(10, 'an article without version_release changes no version', 'created=0 updated=0 unchanged=0', pg_temp.vcounts(r));
  perform pg_temp.check(11, '...and its events are still handled', '1', (r -> 'counts' ->> 'unchanged'));

  -- ---------- The view ----------
  select g.user_id, g.id, g.timezone into v_user, v_game, v_tz
    from public.games g where g.preset_id = 'wuwa' order by g.created_at limit 1;
  if v_game is null then raise exception 'No Wuthering Waves game found to test with.'; end if;

  insert into public.catalog_versions (game, version, released_at) values ('wuwa', 'zzv', '2031-06-01T03:00:00Z');
  insert into public.catalog_events (id, game, version, kind, server_scope, name, name_key, starts_local, ends_local, time_basis, utc_offset_minutes, start_rule, status) values
    (c_srv,   'wuwa', 'zzv',   'event', 'all', 'ZZ Ver Server', 'zz ver server', null,               '2031-06-20 03:59', 'server_local', null, 'after_update', 'confirmed'),
    (c_fix,   'wuwa', 'zzv',   'event', 'all', 'ZZ Ver Fixed',  'zz ver fixed',  null,               '2031-06-20 23:59', 'fixed_offset', 480,  'after_update', 'confirmed'),
    (c_exact, 'wuwa', 'zzv',   'event', 'all', 'ZZ Ver Exact',  'zz ver exact',  '2031-06-05 04:00', '2031-06-20 03:59', 'server_local', null, 'exact',        'confirmed'),
    (c_nover, 'wuwa', 'zzv-x', 'event', 'all', 'ZZ Ver None',   'zz ver none',   null,               '2031-06-20 03:59', 'server_local', null, 'after_update', 'confirmed'),
    (c_unk,   'wuwa', 'zzv',   'event', 'all', 'ZZ Ver Unknown','zz ver unknown',null,               '2031-06-20 03:59', 'server_local', null, 'unknown',      'confirmed');

  select (starts_at = '2031-06-01T03:00:00Z')::text into got from public.user_events where user_id = v_user and catalog_event_id = c_srv;
  perform pg_temp.check(12, 'server-time "after update" event starts when the version went live', 'true', got);
  select (starts_at = '2031-06-01T03:00:00Z')::text into got from public.user_events where user_id = v_user and catalog_event_id = c_fix;
  perform pg_temp.check(13, 'fixed UTC+8 "after update" event starts then too', 'true', got);
  select (starts_at = ('2031-06-05 04:00'::timestamp at time zone v_tz))::text into got from public.user_events where user_id = v_user and catalog_event_id = c_exact;
  perform pg_temp.check(14, 'a printed start is used as before', 'true', got);
  select coalesce(starts_at::text, 'empty') into got from public.user_events where user_id = v_user and catalog_event_id = c_nover;
  perform pg_temp.check(15, 'version not known yet: start stays empty (already running)', 'empty', got);
  select coalesce(starts_at::text, 'empty') into got from public.user_events where user_id = v_user and catalog_event_id = c_unk;
  perform pg_temp.check(16, 'an unknown start does not borrow the version date', 'empty', got);

  -- ---------- Who can do what ----------
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_user)::text, true);
  set local role authenticated;
  select count(*)::text into got from public.catalog_versions where game = 'wuwa' and version = 'zzv';
  reset role;
  perform pg_temp.check(17, 'signed-in users can read version dates', '1', got);

  begin
    set local role authenticated;
    insert into public.catalog_versions (game, version, released_at) values ('zztest', 'x', now());
    got := 'allowed';
  exception when insufficient_privilege then got := 'denied';
  end;
  reset role;
  perform pg_temp.check(18, 'signed-in users cannot add version dates', 'denied', got);

  begin
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
    perform count(*) from public.catalog_versions;
    got := 'allowed';
  exception when insufficient_privilege then got := 'denied';
  end;
  reset role;
  perform pg_temp.check(19, 'logged-out visitors cannot read version dates', 'denied', got);

  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    set local role service_role;
    delete from public.catalog_versions where game = 'zztest';
    got := 'allowed';
  exception when insufficient_privilege then got := 'denied';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(20, 'the ingest role cannot delete version dates', 'denied', got);

  -- ---------- Clean up ----------
  delete from public.catalog_events where game = 'zztest' or (game = 'wuwa' and version in ('zzv', 'zzv-x'));
  delete from public.catalog_versions where game = 'zztest' or (game = 'wuwa' and version = 'zzv');
  delete from public.source_articles where source = 'zztest_source';
  delete from public.catalog_trust_rules where source = 'zztest_source';
end;
$$;

-- Every row should show pass = true
select n, scenario, expected, got, pass from version_results order by n;

-- ---------- cleanup, only if a run was interrupted (select these lines and run them) ----------
-- delete from public.catalog_events where game = 'zztest' or (game = 'wuwa' and version in ('zzv', 'zzv-x'));
-- delete from public.catalog_versions where game = 'zztest' or (game = 'wuwa' and version = 'zzv');
-- delete from public.source_articles where source = 'zztest_source';
-- delete from public.catalog_trust_rules where source = 'zztest_source';
