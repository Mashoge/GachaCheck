-- Scenario tests for the public.user_events view.
--
-- Run in the Supabase SQL editor (paste the whole file, click Run) or with psql.
-- Needs: at least one account with a Wuthering Waves game (preset 'wuwa').
-- It adds a few catalog events and personal events whose names start with 'ZZ View Test',
-- removes them at the end, and finishes with a results table: every row should show pass = true.
-- If a run is interrupted, use the cleanup block at the bottom of this file.

create temp table if not exists view_results (n int, scenario text, expected text, got text, pass boolean);
truncate view_results;
grant all on view_results to public;

create or replace function pg_temp.check(n int, scenario text, expected text, got text) returns void language sql as $$
  insert into view_results values (n, scenario, expected, coalesce(got, '(nothing)'), coalesce(got, '(nothing)') = expected)
$$;

do $$
declare
  v_user  uuid;
  v_game  uuid;
  v_tz    text;
  v_srv   text;
  v_web   boolean;
  c_local uuid := gen_random_uuid();   -- server-time event
  c_fixed uuid := gen_random_uuid();   -- web event on a fixed UTC+8 clock
  c_wait  uuid := gen_random_uuid();   -- not confirmed
  c_ban   uuid := gen_random_uuid();   -- banner
  c_other uuid := gen_random_uuid();   -- another server only
  c_dup   uuid := gen_random_uuid();   -- also entered by hand
  e_dup   uuid;
  e_own   uuid;
  got     text;
begin
  select g.user_id, g.id, g.timezone, g.server into v_user, v_game, v_tz, v_srv
    from public.games g where g.preset_id = 'wuwa' order by g.created_at limit 1;
  if v_game is null then raise exception 'No Wuthering Waves game found to test with.'; end if;
  if exists (select 1 from public.catalog_events where name like 'ZZ View Test%')
     or exists (select 1 from public.events where name like 'ZZ View Test%') then
    raise exception 'Leftover test rows found. Run the cleanup block at the bottom of this file first.';
  end if;
  select coalesce(show_web_events, true) into v_web from public.user_settings where user_id = v_user;

  insert into public.catalog_events (id, game, version, kind, server_scope, name, name_key, starts_local, ends_local, time_basis, utc_offset_minutes, start_rule, official_url, status) values
    (c_local, 'wuwa', 'zz', 'event',     'all',     'ZZ View Test Local',  'zz view test local',  '2031-03-01 04:00', '2031-03-15 03:59', 'server_local', null, 'exact', null, 'confirmed'),
    (c_fixed, 'wuwa', 'zz', 'web_event', 'all',     'ZZ View Test Web',    'zz view test web',    null,               '2031-03-15 23:59', 'fixed_offset', 480,  'after_update', 'https://example.com/zz', 'confirmed'),
    (c_wait,  'wuwa', 'zz', 'event',     'all',     'ZZ View Test Wait',   'zz view test wait',   '2031-03-01 04:00', '2031-03-15 03:59', 'server_local', null, 'exact', null, 'needs_review'),
    (c_ban,   'wuwa', 'zz', 'banner',    'all',     'ZZ View Test Banner', 'zz view test banner', '2031-03-01 04:00', '2031-03-15 03:59', 'server_local', null, 'exact', null, 'confirmed'),
    (c_other, 'wuwa', 'zz', 'event',     'zz-none', 'ZZ View Test Other',  'zz view test other',  '2031-03-01 04:00', '2031-03-15 03:59', 'server_local', null, 'exact', null, 'confirmed'),
    (c_dup,   'wuwa', 'zz', 'event',     'all',     'ZZ View Test Dup',    'zz view test dup',    '2031-03-01 04:00', '2031-03-15 03:59', 'server_local', null, 'exact', null, 'confirmed');

  -- The user's own entries: one duplicate of a catalog event (already marked done), one unrelated
  insert into public.events (user_id, game_id, name, ends_at, completed_at)
    values (v_user, v_game, '[ZZ View Test: Dup]', ('2031-03-15 03:59'::timestamp at time zone v_tz) - interval '1 minute', now())
    returning id into e_dup;
  insert into public.events (user_id, game_id, name, ends_at)
    values (v_user, v_game, 'ZZ View Test Own', '2031-04-01 00:00+00') returning id into e_own;
  update public.user_settings set show_web_events = true where user_id = v_user;

  -- 1. Which catalog events are listed
  select string_agg(name, ', ' order by name) into got from public.user_events
   where user_id = v_user and origin = 'catalog' and name like 'ZZ View Test%';
  perform pg_temp.check(1, 'lists confirmed events and web events only',
    'ZZ View Test Dup, ZZ View Test Local, ZZ View Test Web', got);

  -- 2. Server-time event becomes the right moment for the game's server
  select (ends_at = ('2031-03-15 03:59'::timestamp at time zone v_tz) and starts_at = ('2031-03-01 04:00'::timestamp at time zone v_tz))::text
    into got from public.user_events where user_id = v_user and catalog_event_id = c_local;
  perform pg_temp.check(2, 'server-time dates use the game''s server time zone', 'true', got);

  -- 3. Fixed UTC+8 time, and an unknown start stays empty
  select (ends_at = '2031-03-15 15:59+00' and starts_at is null)::text
    into got from public.user_events where user_id = v_user and catalog_event_id = c_fixed;
  perform pg_temp.check(3, 'fixed UTC+8 time converts exactly; unknown start is empty', 'true', got);

  -- 4. Web events carry their kind and link
  select kind || ' ' || official_url into got from public.user_events where user_id = v_user and catalog_event_id = c_fixed;
  perform pg_temp.check(4, 'web event keeps its kind and official link', 'web_event https://example.com/zz', got);

  -- 5. IDs
  select (id = 'cat:' || c_local::text)::text into got from public.user_events where user_id = v_user and catalog_event_id = c_local;
  perform pg_temp.check(5, 'catalog ids are prefixed', 'true', got);

  -- 6-7. Duplicate: own entry is hidden, its done mark carries over
  select count(*)::text into got from public.user_events where user_id = v_user and own_event_id = e_dup;
  perform pg_temp.check(6, 'own duplicate of a catalog event is not listed', '0', got);
  select (completed_at is not null)::text into got from public.user_events where user_id = v_user and catalog_event_id = c_dup;
  perform pg_temp.check(7, 'done mark carries over from the own duplicate', 'true', got);

  -- 8. Once the user sets their own mark on the catalog event, that mark wins
  insert into public.user_event_state (user_id, event_id, completed_at) values (v_user, c_dup, null);
  select (completed_at is null)::text into got from public.user_events where user_id = v_user and catalog_event_id = c_dup;
  perform pg_temp.check(8, 'the user''s own mark on the catalog event wins', 'true', got);

  -- 9. Unrelated own event still listed, unchanged
  select origin || ' ' || source || ' ' || kind into got from public.user_events where user_id = v_user and own_event_id = e_own;
  perform pg_temp.check(9, 'other own events are listed as before', 'own manual event', got);

  -- 10-11. Marks: note and reminder, then hide
  insert into public.user_event_state (user_id, event_id, note, remind) values (v_user, c_local, 'half done', false);
  select note || ' ' || remind::text into got from public.user_events where user_id = v_user and catalog_event_id = c_local;
  perform pg_temp.check(10, 'note and reminder marks show on the event', 'half done false', got);
  update public.user_event_state set hidden = true where user_id = v_user and event_id = c_local;
  select count(*)::text into got from public.user_events where user_id = v_user and catalog_event_id = c_local;
  perform pg_temp.check(11, 'a hidden catalog event is not listed', '0', got);

  -- 12. Hiding the catalog version does not bring the own duplicate back
  update public.user_event_state set hidden = true where user_id = v_user and event_id = c_dup;
  select count(*)::text into got from public.user_events where user_id = v_user and (own_event_id = e_dup or catalog_event_id = c_dup);
  perform pg_temp.check(12, 'hiding the catalog version keeps the duplicate hidden too', '0', got);

  -- 13. The web events switch
  update public.user_settings set show_web_events = false where user_id = v_user;
  select count(*)::text into got from public.user_events where user_id = v_user and catalog_event_id = c_fixed;
  perform pg_temp.check(13, 'web events switch off hides web events', '0', got);
  update public.user_settings set show_web_events = true where user_id = v_user;

  -- 14-16. Who can read what (as the Data API would run it)
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_user)::text, true);
  set local role authenticated;
  select count(*)::text into got from public.user_events where name like 'ZZ View Test%';
  reset role;
  perform pg_temp.check(14, 'signed-in owner reads their list through the view', '2', got);

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', gen_random_uuid())::text, true);
  set local role authenticated;
  select count(*)::text into got from public.user_events;
  reset role;
  perform pg_temp.check(15, 'another signed-in user sees none of this user''s events', '0', got);

  begin
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
    perform count(*) from public.user_events;
    got := 'allowed';
  exception when insufficient_privilege then
    got := 'denied';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(16, 'logged-out visitor cannot read the view', 'denied', got);

  -- 17. The reminder job (server role) sees every user's rows, with the owner on each
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  select count(*)::text into got from public.user_events where user_id = v_user and name like 'ZZ View Test%';
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(17, 'server role reads the view for the reminder job', '2', got);

  -- Clean up, and put the user's own web events setting back
  update public.user_settings set show_web_events = v_web where user_id = v_user;
  delete from public.catalog_events where name like 'ZZ View Test%';
  delete from public.events where name like '%ZZ View Test%';
end;
$$;

-- Every row should show pass = true
select n, scenario, expected, got, pass from view_results order by n;

-- ---------- cleanup, only if a run was interrupted (select these lines and run them) ----------
-- delete from public.catalog_events where name like 'ZZ View Test%';
-- delete from public.events where name like '%ZZ View Test%';
