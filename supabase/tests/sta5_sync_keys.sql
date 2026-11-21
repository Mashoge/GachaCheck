-- Scenario tests for STA-5 (helper keys and public.sync_genshin): what a key can and cannot do.
--
-- Run in the Supabase SQL editor (paste the whole file, click Run) or with psql.
-- Needs: at least one account with a Genshin Impact game (preset 'genshin').
-- It adds a Resin meter and a "Daily commissions" task to that game only if they're missing, makes test
-- keys named 'ZZ Sync …', a second test account with its own Genshin game, and removes all of it at the
-- end. Your own Resin value is put back afterwards, and a commissions tick you already had today is kept
-- (the test then expects "already"). It finishes with a results table: every row should show pass = true.

create temp table if not exists sync_results (n int, scenario text, expected text, got text, pass boolean);
truncate sync_results;
grant all on sync_results to public;

create or replace function pg_temp.check(n int, scenario text, expected text, got text) returns void language sql as $$
  insert into sync_results values (n, scenario, expected, coalesce(got, '(nothing)'), coalesce(got, '(nothing)') = expected)
$$;

-- Runs one statement and gives back its first value, or 'refused' if the database said no
create or replace function pg_temp.try(sql text) returns text language plpgsql as $$
declare got text;
begin
  execute sql into got;
  return coalesce(got, 'ok');
exception when others then return 'refused';
end;
$$;

do $$
declare
  v_user   uuid;
  v_game   uuid;
  v_other  uuid := gen_random_uuid();
  v_ogame  uuid;
  v_meter  uuid;
  v_task   uuid;
  v_added_meter boolean := false;
  v_added_task  boolean := false;
  v_had_tick    boolean;
  v_old_value   integer;
  v_old_at      timestamptz;
  v_key    text;
  v_key2   text;
  v_res    jsonb;
  v_day    timestamptz;
  got      text;
  n        int;
begin
  select g.user_id, g.id into v_user, v_game from public.games g where g.preset_id = 'genshin' order by g.created_at limit 1;
  if v_game is null then raise exception 'No Genshin Impact game found to test with.'; end if;
  if exists (select 1 from public.sync_keys where label like 'ZZ Sync%') then
    raise exception 'Leftover test keys found. Run the cleanup block at the bottom of this file first.';
  end if;

  select id into v_meter from public.stamina_meters where game_id = v_game and preset_key = 'resin';
  if v_meter is null then
    insert into public.stamina_meters (user_id, game_id, name, cap, minutes_per_point, current_value, preset_key)
    values (v_user, v_game, 'Original Resin', 200, 8, 0, 'resin') returning id into v_meter;
    v_added_meter := true;
  end if;
  select id into v_task from public.tasks where game_id = v_game and preset_key = 'commissions';
  if v_task is null then
    insert into public.tasks (user_id, game_id, title, preset_key) values (v_user, v_game, 'Daily commissions', 'commissions')
    returning id into v_task;
    v_added_task := true;
  end if;
  select current_value, value_recorded_at into v_old_value, v_old_at from public.stamina_meters where id = v_meter;

  -- Today, the app's way: the game's local date at its reset time, or the day before if that's still ahead
  select (case when (now() at time zone g.timezone) >= (now() at time zone g.timezone)::date + g.daily_reset_time
               then (now() at time zone g.timezone)::date + g.daily_reset_time
               else (now() at time zone g.timezone)::date - 1 + g.daily_reset_time end) at time zone g.timezone
  into v_day from public.games g where g.id = v_game;
  v_had_tick := exists (select 1 from public.completions where task_id = v_task and period_start = v_day);

  -- A second account with its own Genshin game, which must never change
  insert into auth.users (id, email) values (v_other, 'zz-sync-other@example.com');
  insert into public.games (user_id, name, preset_id, server, timezone, daily_reset_time)
  values (v_other, 'Genshin Impact', 'genshin', 'asia', 'Etc/GMT-8', '04:00') returning id into v_ogame;
  insert into public.stamina_meters (user_id, game_id, name, cap, minutes_per_point, current_value, preset_key)
  values (v_other, v_ogame, 'Original Resin', 200, 8, 77, 'resin');

  -- ---------- making keys (signed in as you) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_key := public.create_sync_key('ZZ Sync PC');
  v_key2 := public.create_sync_key('ZZ Sync laptop');
  perform pg_temp.check(1, 'a new key is long and random', 'true', (v_key ~ '^gcs_[0-9a-f]{64}$' and v_key <> v_key2)::text);
  select count(*)::text into got from public.sync_keys where label like 'ZZ Sync%';
  perform pg_temp.check(2, 'you see your own keys', '2', got);
  perform pg_temp.check(3, 'you can''t read a key''s fingerprint, even your own', 'refused',
    pg_temp.try('select key_hash from public.sync_keys limit 1'));
  perform pg_temp.check(4, 'you can''t write a key yourself (only create_sync_key makes them)', 'refused',
    pg_temp.try(format('insert into public.sync_keys (user_id, label, key_hash, key_hint) values (%L, ''ZZ Sync fake'', repeat(''a'', 64), ''aaaa'') returning id', v_user)));
  perform public.create_sync_key('ZZ Sync third');
  perform pg_temp.check(5, 'a fourth key is refused (3 at most)', 'refused', pg_temp.try('select public.create_sync_key(''ZZ Sync fourth'')'));
  reset role;
  perform set_config('request.jwt.claims', '', true);

  select (key_hash = encode(sha256(convert_to(v_key, 'UTF8')), 'hex') and key_hash <> v_key and key_hint = right(v_key, 4))::text
  into got from public.sync_keys where label = 'ZZ Sync PC';
  perform pg_temp.check(6, 'only the fingerprint is stored, plus the last 4 characters', 'true', got);

  -- ---------- not signed in: the helper ----------
  set local role anon;
  perform pg_temp.check(7, 'logged out: keys can''t be listed', 'refused', pg_temp.try('select count(*) from public.sync_keys'));
  perform pg_temp.check(8, 'logged out: no new keys', 'refused', pg_temp.try('select public.create_sync_key(''ZZ Sync anon'')'));
  perform pg_temp.check(9, 'a malformed key is refused', 'refused', pg_temp.try('select public.sync_genshin(''hello'', 100, 0, false)'));
  perform pg_temp.check(10, 'a well-formed key that doesn''t exist is refused', 'refused',
    pg_temp.try(format('select public.sync_genshin(%L, 100, 0, false)', 'gcs_' || repeat('0', 64))));
  perform pg_temp.check(11, 'Resin over 2000 is refused', 'refused', pg_temp.try(format('select public.sync_genshin(%L, 2001, 0, false)', v_key)));

  -- 120 Resin, full in 10 hours 35 minutes: 80 points × 8 min = 10h40m, so 5 minutes into the next point
  v_res := public.sync_genshin(v_key, 120, 38100, true);
  perform pg_temp.check(12, 'a sync sets Resin and ticks finished commissions', '120 ' || case when v_had_tick then 'already' else 'ticked' end,
    (v_res ->> 'resin') || ' ' || (v_res ->> 'commissions'));
  perform pg_temp.check(13, 'a second sync within a minute does nothing', 'too_soon', public.sync_genshin(v_key, 5, 0, true) ->> 'skipped');
  reset role;

  select current_value::text into got from public.stamina_meters where id = v_meter;
  perform pg_temp.check(14, 'the meter holds the synced Resin', '120', got);
  select round(extract(epoch from (now() - value_recorded_at)))::text into got from public.stamina_meters where id = v_meter;
  perform pg_temp.check(15, 'the refill countdown lines up with HoYoLAB (stamped 5 minutes back)', '300', got);

  select count(*)::text into got from public.completions where task_id = v_task and period_start = v_day;
  perform pg_temp.check(16, 'the tick counts for today, as the app reckons it', '1', got);

  update public.sync_keys set last_used_at = now() - interval '2 minutes' where label = 'ZZ Sync PC';
  set local role anon;
  perform pg_temp.check(17, 'commissions are ticked only once a day', 'already', public.sync_genshin(v_key, 121, 0, true) ->> 'commissions');
  reset role;
  set local role anon;
  perform pg_temp.check(18, 'commissions not finished: nothing ticked', 'not_done', public.sync_genshin(v_key2, 50, 0, false) ->> 'commissions');
  reset role;

  select count(*)::text into got from public.completions where task_id = v_task and period_start = v_day;
  perform pg_temp.check(19, 'still one tick for today', '1', got);
  select current_value::text into got from public.stamina_meters where game_id = v_ogame;
  perform pg_temp.check(20, 'another account''s Genshin is never touched', '77', got);
  select (last_result ->> 'commissions') into got from public.sync_keys where label = 'ZZ Sync laptop';
  perform pg_temp.check(21, 'the app can show what the last sync did', 'not_done', got);

  -- ---------- cancelling ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.sync_keys where label = 'ZZ Sync laptop';
  get diagnostics n = row_count;
  perform pg_temp.check(22, 'you can cancel your own key', '1', n::text);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.sync_keys where label = 'ZZ Sync PC';
  get diagnostics n = row_count;
  perform pg_temp.check(23, 'nobody else can cancel (or see) your keys', '0', n::text);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  perform pg_temp.check(24, 'a cancelled key stops working', 'refused', pg_temp.try(format('select public.sync_genshin(%L, 100, 0, false)', v_key2)));
  reset role;

  -- Clean up
  delete from public.sync_keys where label like 'ZZ Sync%';
  if not v_had_tick then delete from public.completions where task_id = v_task and period_start = v_day; end if;
  update public.stamina_meters set current_value = v_old_value, value_recorded_at = v_old_at where id = v_meter;
  delete from public.games where id = v_ogame;
  delete from auth.users where id = v_other;
  if v_added_task then delete from public.tasks where id = v_task; end if;
  if v_added_meter then delete from public.stamina_meters where id = v_meter; end if;
end;
$$;

-- Every row should show pass = true
select n, scenario, expected, got, pass from sync_results order by n;

-- Cleanup if a run was interrupted:
-- delete from public.sync_keys where label like 'ZZ Sync%';
-- delete from auth.users where email = 'zz-sync-other@example.com';
