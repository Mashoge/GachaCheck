-- Scenario tests for public.catalog_ingest (the event catalog's write path).
--
-- Run in the Supabase SQL editor (paste the whole file, click Run) or with psql.
-- Needs: the catalog migrations applied and at least one row in public.app_admins.
-- It uses a fake game 'zztest' and source 'zztest_source', removes all of its rows at the end,
-- and finishes with a results table: every row should show pass = true.
-- If a run is interrupted, delete leftovers with the cleanup block at the bottom of this file.

-- ---------- helpers (temporary, gone when the session ends) ----------
create temp table if not exists ingest_results (n int, scenario text, expected text, got text, pass boolean);
truncate ingest_results;

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

-- One article in a payload
create or replace function pg_temp.art(id text, obs jsonb, complete boolean default true, hash text default 'h1', kind text default 'patch_notes')
returns jsonb language sql as $$
  select jsonb_build_object('external_id', id, 'title', 'Test article ' || id, 'url', null, 'article_kind', kind,
    'published_at', '2030-01-01T10:00:00+08:00', 'content_hash', hash, 'complete', complete, 'observations', obs)
$$;

-- A payload with one or more articles
create or replace function pg_temp.run(articles jsonb) returns jsonb language sql as $$
  select jsonb_build_object('source', 'zztest_source', 'game', 'zztest', 'articles', articles)
$$;

-- One observation (a regular trusted event unless "extra" says otherwise)
create or replace function pg_temp.o(k text, name text, s text, e text, extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('observed_key', k, 'kind', 'event', 'version', '9.9', 'server_scope', 'all', 'name', name,
    'occurrence_key', '', 'starts_local', s, 'ends_local', e, 'time_basis', 'server_local', 'utc_offset_minutes', null,
    'start_rule', case when s is null then 'after_update' else 'exact' end, 'official_url', null,
    'task_preset_key', null, 'raw_text', 'test line', 'trusted', true) || extra
$$;

-- Non-zero counts in a fixed order, e.g. 'articles_new=1 created=3'
create or replace function pg_temp.summary(r jsonb) returns text language sql as $$
  select coalesce(string_agg(k || '=' || (r -> 'counts' ->> k), ' ' order by ord), 'nothing')
  from unnest(array['articles_new', 'articles_changed', 'created', 'updated', 'unchanged', 'conflict', 'ignored', 'skipped', 'missing'])
       with ordinality as t(k, ord)
  where (r -> 'counts' ->> k)::int <> 0
$$;

create or replace function pg_temp.check(n int, scenario text, expected text, got text) returns void language sql as $$
  insert into ingest_results values (n, scenario, expected, got, got is not distinct from expected)
$$;

create or replace function pg_temp.ends(key text) returns text language sql as $$
  select to_char(ends_local, 'YYYY-MM-DD HH24:MI') from public.catalog_events where game = 'zztest' and name_key = key
$$;

-- ---------- the scenarios ----------
do $$
declare
  v_admin uuid;
  r jsonb;
  three jsonb;
  got text;
begin
  select user_id into v_admin from public.app_admins limit 1;
  if v_admin is null then raise exception 'Add an admin first (BOOTSTRAP_admin.sql).'; end if;
  if exists (select 1 from public.catalog_events where game = 'zztest')
     or exists (select 1 from public.source_articles where source = 'zztest_source') then
    raise exception 'Leftover zztest rows found. Run the cleanup block at the bottom of this file first.';
  end if;

  -- The fake source may confirm events from patch notes (like the real WuWa rule)
  insert into public.catalog_trust_rules (source, article_kind, kind, note) values
    ('zztest_source', 'patch_notes', 'event', 'scenario tests'),
    ('zztest_source', 'patch_notes', 'endgame_cycle', 'scenario tests');

  three := jsonb_build_array(
    pg_temp.o('blocks', 'Lahai-Roi Blocks: Turnabout', '2030-01-10T04:00', '2030-01-24T03:59'),
    pg_temp.o('lollo',  'Lollo Campaign: Groundwork',  '2030-01-24T10:00', '2030-02-07T03:59'),
    pg_temp.o('gifts',  'Gifts of Bygone Dreams',      null,               '2030-02-11T03:59'));

  -- 1. Name matching
  select string_agg(public.catalog_name_key(x), ' | ') into got
    from unnest(array['Hunter''s Crucible', '[Hunters  Crucible]', 'Lahai-Roi Blocks: Turnabout', '“Circle Gifts”']) x;
  perform pg_temp.check(1, 'names normalise to one key', 'hunters crucible | hunters crucible | lahai roi blocks turnabout | circle gifts', got);

  -- 2-3. A dry run of a new article reports exactly, and saves nothing
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('A1', three))), true);
  perform pg_temp.check(2, 'dry run: new article with 3 events', 'articles_new=1 created=3', pg_temp.summary(r));
  perform pg_temp.check(3, 'dry run saved nothing',
    'events=0 articles=0',
    format('events=%s articles=%s', (select count(*) from public.catalog_events where game = 'zztest'),
                                    (select count(*) from public.source_articles where source = 'zztest_source')));

  -- 4-5. The real run
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('A1', three))));
  perform pg_temp.check(4, 'real run: same result as the dry run', 'articles_new=1 created=3', pg_temp.summary(r));
  perform pg_temp.check(5, 'trusted patch-notes events are confirmed', 'confirmed,confirmed,confirmed',
    (select string_agg(status, ',' order by name_key) from public.catalog_events where game = 'zztest'));

  -- 6. Sending the same thing again changes nothing
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('A1', three))));
  perform pg_temp.check(6, 'identical re-run', 'unchanged=3', pg_temp.summary(r));

  -- 7-9. The publisher edits one date (same observed key, new content hash)
  three := jsonb_set(three, '{0,ends_local}', '"2030-01-25T03:59"');
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('A1', three, true, 'h2'))), true);
  perform pg_temp.check(7, 'dry run: edited date matches by key', 'articles_changed=1 updated=1 unchanged=2', pg_temp.summary(r));
  perform pg_temp.check(8, 'that dry run left the date alone', '2030-01-24 03:59', pg_temp.ends('lahai roi blocks turnabout'));
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('A1', three, true, 'h2'))));
  perform pg_temp.check(9, 'real run: date updated in place, still 3 events',
    'articles_changed=1 updated=1 unchanged=2 | 2030-01-25 03:59 | 3',
    pg_temp.summary(r) || ' | ' || pg_temp.ends('lahai roi blocks turnabout') || ' | '
      || (select count(*) from public.catalog_events where game = 'zztest'));

  -- 10. A second article reports the same event with the same dates
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('A2',
         jsonb_build_array(pg_temp.o('preview-blocks', '[Lahai-Roi Blocks: Turnabout]', '2030-01-10T04:00', '2030-01-25T03:59'))))));
  perform pg_temp.check(10, 'second source agrees: one event, two sources', 'articles_new=1 unchanged=1 | sources=2',
    pg_temp.summary(r) || ' | sources=' || (select count(*) from public.catalog_event_sources s join public.catalog_events e on e.id = s.event_id
                                             where e.game = 'zztest' and e.name_key = 'lahai roi blocks turnabout'));

  -- 11. A third article disagrees
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('A3',
         jsonb_build_array(pg_temp.o('other-blocks', 'Lahai-Roi Blocks: Turnabout', '2030-01-10T04:00', '2030-01-31T03:59'))))));
  perform pg_temp.check(11, 'sources disagree: conflict, dates kept, sent to review',
    'articles_new=1 conflict=1 | 2030-01-25 03:59 | needs_review',
    pg_temp.summary(r) || ' | ' || pg_temp.ends('lahai roi blocks turnabout') || ' | '
      || (select status from public.catalog_events where game = 'zztest' and name_key = 'lahai roi blocks turnabout'));

  -- 12-13. A reviewer edits Lollo (this locks it); then the collector sends a new date
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_admin)::text, true);
  set local role authenticated;
  update public.catalog_events set review_note = 'checked in game' where game = 'zztest' and name_key = 'lollo campaign groundwork';
  reset role;
  perform set_config('request.jwt.claims', '', true);

  three := jsonb_set(three, '{1,ends_local}', '"2030-02-08T03:59"');
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('A1', three, true, 'h3'))));
  perform pg_temp.check(12, 'locked event: conflict recorded, no error', 'articles_changed=1 unchanged=2 conflict=1', pg_temp.summary(r));
  perform pg_temp.check(13, 'locked event kept the reviewer''s date', '2030-02-07 03:59 | locked',
    pg_temp.ends('lollo campaign groundwork') || ' | '
      || (select case when locked_at is not null then 'locked' else 'unlocked' end
            from public.catalog_events where game = 'zztest' and name_key = 'lollo campaign groundwork'));

  -- 14-16. A complete article no longer lists Gifts
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('A1', three - 2, true, 'h4'))), true);
  perform pg_temp.check(14, 'dry run: missing observation detected', 'articles_changed=1 unchanged=1 conflict=1 missing=1', pg_temp.summary(r));
  perform pg_temp.check(15, 'that dry run did not mark it missing', 'not missing',
    (select case when missing_since is null then 'not missing' else 'missing' end
       from public.catalog_event_sources s join public.source_articles a on a.id = s.article_id
      where a.source = 'zztest_source' and a.external_id = 'A1' and s.observed_key = 'gifts'));
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('A1', three - 2, true, 'h4'))));
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('A1', jsonb_build_array(three -> 2), false, 'h4'))));
  perform pg_temp.check(16, 'marked missing, then cleared when it came back', 'not missing',
    (select case when missing_since is null then 'not missing' else 'missing' end
       from public.catalog_event_sources s join public.source_articles a on a.id = s.article_id
      where a.source = 'zztest_source' and a.external_id = 'A1' and s.observed_key = 'gifts'));

  -- 17. Two endgame cycles with the same name in one version
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('A4', jsonb_build_array(
         pg_temp.o('cycle-2', 'Check Matrix', null, '2030-02-11T03:59', '{"kind":"endgame_cycle","task_preset_key":"check_matrix","occurrence_key":"cycle-2","start_rule":"unknown","time_basis":"fixed_offset","utc_offset_minutes":480}'),
         pg_temp.o('cycle-3', 'Check Matrix', null, '2030-03-25T03:59', '{"kind":"endgame_cycle","task_preset_key":"check_matrix","occurrence_key":"cycle-3","start_rule":"unknown","time_basis":"fixed_offset","utc_offset_minutes":480}'))))));
  perform pg_temp.check(17, 'two cycles with one name stay separate', 'articles_new=1 created=2 | cycles=2',
    pg_temp.summary(r) || ' | cycles=' || (select count(*) from public.catalog_events where game = 'zztest' and kind = 'endgame_cycle'));

  -- 18. A rejected event is never changed by the collector
  update public.catalog_events set status = 'rejected' where game = 'zztest' and name_key = 'gifts of bygone dreams';
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('A1',
         jsonb_build_array(jsonb_set(three -> 2, '{ends_local}', '"2030-02-12T03:59"')), false, 'h5'))));
  perform pg_temp.check(18, 'rejected event ignored', 'articles_changed=1 ignored=1 | 2030-02-11 03:59',
    pg_temp.summary(r) || ' | ' || pg_temp.ends('gifts of bygone dreams'));

  -- 19. One article reporting the same event under a second key
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('A1',
         jsonb_build_array(pg_temp.o('blocks-again', 'Lahai Roi Blocks Turnabout', '2030-01-10T04:00', '2030-01-25T03:59')), false, 'h5'))));
  perform pg_temp.check(19, 'same event under a second key in one article: skipped', 'skipped=1', pg_temp.summary(r));

  -- 20-22. Trust policy: all three conditions are needed to confirm
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('T1',
         jsonb_build_array(pg_temp.o('t1', 'Trusted But Wrong Article Type', '2030-04-01T04:00', '2030-04-08T03:59')), true, 'h1', 'other'))));
  perform pg_temp.check(20, 'trusted flag, but no rule for this article type', 'needs_review', r -> 'items' -> 0 ->> 'status');
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('T2',
         jsonb_build_array(pg_temp.o('t2', 'Rule But Not Trusted', '2030-04-01T04:00', '2030-04-08T03:59', '{"trusted":false}'))))));
  perform pg_temp.check(21, 'rule exists, but the collector did not mark it trusted', 'needs_review', r -> 'items' -> 0 ->> 'status');
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(pg_temp.art('T3',
         jsonb_build_array(pg_temp.o('t3', 'Trusted With No End', '2030-04-01T04:00', null))))));
  perform pg_temp.check(22, 'trusted and allowed, but no end date', 'needs_review', r -> 'items' -> 0 ->> 'status');

  -- 23-24. Dry run is exact for two new articles reporting the same new event
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(
         pg_temp.art('D1', jsonb_build_array(pg_temp.o('d', 'Double Report', '2030-05-01T04:00', '2030-05-08T03:59'))),
         pg_temp.art('D2', jsonb_build_array(pg_temp.o('d', 'Double Report', '2030-05-01T04:00', '2030-05-08T03:59'))))), true);
  perform pg_temp.check(23, 'dry run: one event created, second report unchanged', 'articles_new=2 created=1 unchanged=1', pg_temp.summary(r));
  r := pg_temp.ingest(pg_temp.run(jsonb_build_array(
         pg_temp.art('D1', jsonb_build_array(pg_temp.o('d', 'Double Report', '2030-05-01T04:00', '2030-05-08T03:59'))),
         pg_temp.art('D2', jsonb_build_array(pg_temp.o('d', 'Double Report', '2030-05-01T04:00', '2030-05-08T03:59'))))));
  perform pg_temp.check(24, 'real run matches the dry run', 'articles_new=2 created=1 unchanged=1', pg_temp.summary(r));

  -- 25. One bad record rolls back the whole run
  begin
    r := pg_temp.ingest(pg_temp.run(jsonb_build_array(
           pg_temp.art('R1', jsonb_build_array(pg_temp.o('fine', 'Fine Event', '2030-06-01T04:00', '2030-06-08T03:59'))),
           pg_temp.art('R2', jsonb_build_array(pg_temp.o('bad', 'Bad Event', null, '2030-06-08T03:59', '{"start_rule":"exact"}'))))));
    got := 'saved';
  exception when others then
    got := 'rolled back';
  end;
  perform pg_temp.check(25, 'a bad record rolls back the whole run', 'rolled back | R1 saved=0',
    got || ' | R1 saved=' || (select count(*) from public.source_articles where source = 'zztest_source' and external_id = 'R1'));

  -- 26-27. Only the server role may call it
  begin
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
    perform public.catalog_ingest('{}'::jsonb, true);
    got := 'allowed';
  exception when insufficient_privilege then
    got := 'denied';
  end;
  reset role;
  perform pg_temp.check(26, 'logged-out visitor cannot call it', 'denied', got);
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_admin)::text, true);
    set local role authenticated;
    perform public.catalog_ingest('{}'::jsonb, true);
    got := 'allowed';
  exception when insufficient_privilege then
    got := 'denied';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(27, 'signed-in user (even an admin) cannot call it', 'denied', got);

  -- Clean up (as the database owner; the collector's role cannot delete)
  delete from public.catalog_events where game = 'zztest';
  delete from public.source_articles where source = 'zztest_source';
  delete from public.catalog_trust_rules where source = 'zztest_source';
end;
$$;

-- Every row should show pass = true
select n, scenario, expected, got, pass from ingest_results order by n;

-- ---------- cleanup, only if a run was interrupted (select these three lines and run them) ----------
-- delete from public.catalog_events where game = 'zztest';
-- delete from public.source_articles where source = 'zztest_source';
-- delete from public.catalog_trust_rules where source = 'zztest_source';
