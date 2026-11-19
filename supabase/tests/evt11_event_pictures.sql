-- Scenario tests for EVT-11 (your own event pictures): where a picture may live, and that the
-- user_events view shows it on both your own events and official ones.
--
-- Run in the Supabase SQL editor (paste the whole file, click Run) or with psql.
-- Needs: at least one account with a Wuthering Waves game (preset 'wuwa').
-- It adds one official event and one personal event named 'ZZ Picture …', removes them at the end, and
-- finishes with a results table: every row should show pass = true.

create temp table if not exists picture_results (n int, scenario text, expected text, got text, pass boolean);
truncate picture_results;
grant all on picture_results to public;

create or replace function pg_temp.check(n int, scenario text, expected text, got text) returns void language sql as $$
  insert into picture_results values (n, scenario, expected, coalesce(got, '(nothing)'), coalesce(got, '(nothing)') = expected)
$$;

-- Tries one change and says whether the database kept it
create or replace function pg_temp.try(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'saved';
exception when check_violation then return 'refused';
end;
$$;

do $$
declare
  v_user  uuid;
  v_game  uuid;
  v_other uuid := gen_random_uuid();   -- someone else's id, for paths outside your folder
  c_id    uuid := gen_random_uuid();
  e_id    uuid;
  mine    text;
  got     text;
begin
  select g.user_id, g.id into v_user, v_game from public.games g where g.preset_id = 'wuwa' order by g.created_at limit 1;
  if v_game is null then raise exception 'No Wuthering Waves game found to test with.'; end if;
  if exists (select 1 from public.catalog_events where name like 'ZZ Picture%')
     or exists (select 1 from public.events where name like 'ZZ Picture%') then
    raise exception 'Leftover test rows found. Run the cleanup block at the bottom of this file first.';
  end if;
  mine := v_user || '/' || v_game || '/event-' || gen_random_uuid() || '.webp';

  insert into public.events (user_id, game_id, name, ends_at) values (v_user, v_game, 'ZZ Picture Own', now() + interval '3 days')
  returning id into e_id;
  insert into public.catalog_events (id, game, version, kind, server_scope, name, name_key, starts_local, ends_local, time_basis, start_rule, status)
  values (c_id, 'wuwa', 'zz', 'event', 'all', 'ZZ Picture Official', 'zz picture official', now()::timestamp - interval '1 day', now()::timestamp + interval '9 days', 'server_local', 'exact', 'confirmed');

  -- ---------- your own events ----------
  perform pg_temp.check(1, 'own event: a picture in your folder for this game is kept', 'saved',
    pg_temp.try(format('update public.events set picture_path = %L where id = %L', mine, e_id)));
  perform pg_temp.check(2, 'own event: a picture in someone else''s folder is refused', 'refused',
    pg_temp.try(format('update public.events set picture_path = %L where id = %L', v_other || '/' || v_game || '/event-x.webp', e_id)));
  perform pg_temp.check(3, 'own event: a picture filed under another game is refused', 'refused',
    pg_temp.try(format('update public.events set picture_path = %L where id = %L', v_user || '/' || gen_random_uuid() || '/event-x.webp', e_id)));
  perform pg_temp.check(4, 'own event: a file that is not an event picture (a game icon) is refused', 'refused',
    pg_temp.try(format('update public.events set picture_path = %L where id = %L', v_user || '/' || v_game || '/icon-x.webp', e_id)));
  perform pg_temp.check(5, 'own event: a path over 200 characters is refused', 'refused',
    pg_temp.try(format('update public.events set picture_path = %L where id = %L', v_user || '/' || v_game || '/event-' || repeat('a', 150) || '.webp', e_id)));

  -- ---------- your marks on an official event ----------
  perform pg_temp.check(6, 'official event: a picture in your folder is kept on your marks', 'saved',
    pg_temp.try(format('insert into public.user_event_state (user_id, event_id, picture_path) values (%L, %L, %L)', v_user, c_id, mine)));
  perform pg_temp.check(7, 'official event: a picture in someone else''s folder is refused', 'refused',
    pg_temp.try(format('update public.user_event_state set picture_path = %L where user_id = %L and event_id = %L', v_other || '/' || v_game || '/event-x.webp', v_user, c_id)));
  perform pg_temp.check(8, 'official event: the shared catalog has no picture column at all', 'false',
    (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catalog_events' and column_name = 'picture_path'))::text);

  -- ---------- the view shows them ----------
  select picture_path into got from public.user_events where user_id = v_user and own_event_id = e_id;
  perform pg_temp.check(9, 'the view shows your own event''s picture', mine, got);
  select picture_path into got from public.user_events where user_id = v_user and catalog_event_id = c_id;
  perform pg_temp.check(10, 'the view shows your picture on an official event', mine, got);

  -- ---------- as the signed-in user: only your own marks ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.user_event_state set picture_path = null where event_id = c_id;
  get diagnostics got = row_count;
  perform pg_temp.check(11, 'you can remove the picture from your own marks', '1', got);
  select count(*)::text into got from public.user_event_state where event_id = c_id and user_id <> v_user;
  perform pg_temp.check(12, 'you see nobody else''s marks or pictures', '0', got);
  reset role;
  perform set_config('request.jwt.claims', '', true);

  select coalesce(picture_path, '(none)') into got from public.user_events where user_id = v_user and catalog_event_id = c_id;
  perform pg_temp.check(13, 'once removed, the official event shows no picture', '(none)', got);

  -- Clean up
  delete from public.catalog_events where id = c_id;   -- your marks go with it
  delete from public.events where id = e_id;
end;
$$;

-- Every row should show pass = true
select n, scenario, expected, got, pass from picture_results order by n;

-- Cleanup if a run was interrupted:
-- delete from public.catalog_events where name like 'ZZ Picture%';
-- delete from public.events where name like 'ZZ Picture%';
