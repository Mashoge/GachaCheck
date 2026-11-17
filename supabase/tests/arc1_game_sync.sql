-- ARC-1 scenario test: adding and syncing a game is all or nothing, and keeps the player's settings.
-- Run after 20261118120000_game_sync.sql in the Supabase SQL Editor (or psql). Uses the first
-- account in auth.users, runs as that signed-in player, and rolls everything back at the end.

begin;

create temporary table arc1 (k text primary key, id uuid, body jsonb);
grant select, insert, update on arc1 to authenticated;

-- Version 1 of a made-up preset; version 2 renames, retires, adds and changes things
insert into arc1 (k, body) values
('v1', $j${
  "preset_id": "zz-arc1", "version": 1, "name": "ZZ ARC-1 test", "server": "asia", "timezone": "Etc/GMT-8",
  "daily_reset_time": "04:00", "weekly_reset_day": 1,
  "tasks": [
    {"key": "daily",  "title": "ZZ Daily",  "frequency": "daily",  "category": "routine", "optional": false, "note": null,
     "monthly_day": null, "cycle_anchor": null, "cycle_days": null, "cycle_ends_at": null},
    {"key": "opt",    "title": "ZZ Optional", "frequency": "weekly", "category": "routine", "optional": true, "note": null,
     "monthly_day": null, "cycle_anchor": null, "cycle_days": null, "cycle_ends_at": null, "weekly_target": 2},
    {"key": "ends",   "title": "ZZ Endgame", "frequency": "dated", "category": "endgame", "optional": false, "note": null,
     "monthly_day": null, "cycle_anchor": null, "cycle_days": null, "cycle_ends_at": "2026-11-12T04:00"},
    {"key": "target", "title": "ZZ Target", "frequency": "weekly", "category": "routine", "optional": false, "note": null,
     "monthly_day": null, "cycle_anchor": null, "cycle_days": null, "cycle_ends_at": null},
    {"key": "retire", "title": "ZZ Retired later", "frequency": "daily", "category": "routine", "optional": false, "note": null,
     "monthly_day": null, "cycle_anchor": null, "cycle_days": null, "cycle_ends_at": null}
  ],
  "meters": [
    {"key": "crystals", "name": "ZZ Crystals", "cap": 480, "minutes_per_point": 12, "fills_when_full_of_key": "plates"},
    {"key": "plates",   "name": "ZZ Plates",   "cap": 240, "minutes_per_point": 6,  "fills_when_full_of_key": null},
    {"key": "gone",     "name": "ZZ Gone",     "cap": 10,  "minutes_per_point": 60, "fills_when_full_of_key": null}
  ]
}$j$),
('v2', $j${
  "preset_id": "zz-arc1", "version": 2, "name": "ZZ ARC-1 test", "server": "asia", "timezone": "Etc/GMT-8",
  "daily_reset_time": "05:00", "weekly_reset_day": 1,
  "tasks": [
    {"key": "new",    "title": "ZZ New",  "frequency": "daily", "category": "routine", "optional": false, "note": null,
     "monthly_day": null, "cycle_anchor": null, "cycle_days": null, "cycle_ends_at": null},
    {"key": "daily",  "title": "ZZ Daily (renamed)", "frequency": "daily", "category": "routine", "optional": false, "note": null,
     "monthly_day": null, "cycle_anchor": null, "cycle_days": null, "cycle_ends_at": null},
    {"key": "opt",    "title": "ZZ Optional", "frequency": "weekly", "category": "routine", "optional": true, "note": null,
     "monthly_day": null, "cycle_anchor": null, "cycle_days": null, "cycle_ends_at": null, "weekly_target": 2},
    {"key": "ends",   "title": "ZZ Endgame", "frequency": "dated", "category": "endgame", "optional": false, "note": null,
     "monthly_day": null, "cycle_anchor": null, "cycle_days": null, "cycle_ends_at": "2026-11-26T04:00"},
    {"key": "target", "title": "ZZ Target", "frequency": "weekly", "category": "routine", "optional": false, "note": null,
     "monthly_day": null, "cycle_anchor": null, "cycle_days": null, "cycle_ends_at": null}
  ],
  "meters": [
    {"key": "crystals", "name": "ZZ Crystals", "cap": 480, "minutes_per_point": 12, "fills_when_full_of_key": "plates"},
    {"key": "plates",   "name": "ZZ Plates",   "cap": 250, "minutes_per_point": 6,  "fills_when_full_of_key": null}
  ]
}$j$);

select set_config('request.jwt.claims',
  json_build_object('sub', (select id from auth.users order by created_at limit 1), 'role', 'authenticated')::text, true);
do $$ begin
  if auth.uid() is null then raise exception 'Create or use a signed-in account before running the ARC-1 test.'; end if;
end $$;
set local role authenticated;

-- 1. Add a game: tasks, meters and version arrive together
do $$
declare
  v_game uuid;
  v_n integer;
begin
  v_game := public.add_game_from_preset((select body from arc1 where k = 'v1'), 7);
  insert into arc1 (k, id) values ('game', v_game);

  select count(*) into v_n from public.tasks where game_id = v_game;
  if v_n <> 5 then raise exception 'ARC-1 failure: expected 5 tasks after add, got %', v_n; end if;
  if not (select hidden from public.tasks where game_id = v_game and preset_key = 'opt') then
    raise exception 'ARC-1 failure: an optional preset task should start hidden';
  end if;
  if (select string_agg(preset_key, ',' order by sort_order) from public.tasks where game_id = v_game) <> 'daily,opt,ends,target,retire' then
    raise exception 'ARC-1 failure: new tasks should follow preset order';
  end if;
  if (select fills_when_full_of from public.stamina_meters where game_id = v_game and preset_key = 'crystals')
     is distinct from (select id from public.stamina_meters where game_id = v_game and preset_key = 'plates') then
    raise exception 'ARC-1 failure: overflow meter is not linked to the meter it waits for';
  end if;
  if (select preset_version from public.games where id = v_game) <> 1 then
    raise exception 'ARC-1 failure: preset version not saved with the game';
  end if;
end $$;

-- 2. The player makes the game their own (the same writes the app makes)
do $$
declare
  v_game uuid := (select id from arc1 where k = 'game');
begin
  update public.tasks set hidden = true where game_id = v_game and preset_key = 'daily';
  update public.tasks set cycle_ends_at = '2026-12-22T03:59', cycle_anchor = '2026-11-12' where game_id = v_game and preset_key = 'ends';
  update public.tasks set weekly_target = 4 where game_id = v_game and preset_key = 'target';
  insert into public.tasks (game_id, title, frequency, sort_order) values (v_game, 'ZZ My own task', 'daily', 1000);
  update public.stamina_meters set ping_at = 200, spend_presets = '{40,60}', current_value = 100
  where game_id = v_game and preset_key = 'plates';
  -- A custom order: reversed, with the player's own task first
  update public.tasks set sort_order = case preset_key
    when 'retire' then 10 when 'target' then 20 when 'ends' then 30 when 'opt' then 40 when 'daily' then 50 else 5 end
  where game_id = v_game;
  update public.games set task_order_customized = true where id = v_game;
  insert into arc1 (k, id) values ('plates', (select id from public.stamina_meters where game_id = v_game and preset_key = 'plates'));
end $$;

-- 3. Sync to version 2: preset changes arrive, the player's settings stay
do $$
declare
  v_game uuid := (select id from arc1 where k = 'game');
  v_t public.tasks;
  v_m public.stamina_meters;
begin
  if not public.sync_game_preset(v_game, (select body from arc1 where k = 'v2')) then
    raise exception 'ARC-1 failure: sync to a newer version reported nothing to do';
  end if;

  select * into v_t from public.tasks where game_id = v_game and preset_key = 'daily';
  if v_t.title <> 'ZZ Daily (renamed)' then raise exception 'ARC-1 failure: preset rename not applied'; end if;
  if not v_t.hidden then raise exception 'ARC-1 failure: hidden flag was changed by the sync'; end if;
  if v_t.sort_order <> 50 then raise exception 'ARC-1 failure: custom task order was replaced'; end if;

  if not (select archived from public.tasks where game_id = v_game and preset_key = 'retire') then
    raise exception 'ARC-1 failure: a task removed from the preset should be archived';
  end if;
  -- New preset task goes after the player's last active task (50), not into preset slot 0
  if (select sort_order from public.tasks where game_id = v_game and preset_key = 'new') <> 51 then
    raise exception 'ARC-1 failure: new preset task should go after the last active task (expected 51, got %)',
      (select sort_order from public.tasks where game_id = v_game and preset_key = 'new');
  end if;

  select * into v_t from public.tasks where game_id = v_game and preset_key = 'ends';
  if v_t.cycle_ends_at <> '2026-12-22T03:59'::timestamp or v_t.cycle_anchor <> '2026-11-12'::date then
    raise exception 'ARC-1 failure: a later end date entered by the player was replaced (%, %)', v_t.cycle_ends_at, v_t.cycle_anchor;
  end if;
  if (select weekly_target from public.tasks where game_id = v_game and preset_key = 'target') <> 4 then
    raise exception 'ARC-1 failure: the player''s weekly target was replaced';
  end if;
  if not exists (select 1 from public.tasks where game_id = v_game and title = 'ZZ My own task' and not archived and sort_order = 5) then
    raise exception 'ARC-1 failure: the player''s own task was changed';
  end if;

  select * into v_m from public.stamina_meters where game_id = v_game and preset_key = 'plates';
  if v_m.id <> (select id from arc1 where k = 'plates') then raise exception 'ARC-1 failure: meter was recreated'; end if;
  if v_m.cap <> 250 then raise exception 'ARC-1 failure: new cap not applied'; end if;
  if v_m.ping_at <> 200 or v_m.spend_presets <> '{40,60}' or v_m.current_value <> 100 then
    raise exception 'ARC-1 failure: meter settings were lost (ping_at %, spend %, value %)', v_m.ping_at, v_m.spend_presets, v_m.current_value;
  end if;
  if exists (select 1 from public.stamina_meters where game_id = v_game and preset_key = 'gone') then
    raise exception 'ARC-1 failure: a meter removed from the preset is still there';
  end if;
  if (select fills_when_full_of from public.stamina_meters where game_id = v_game and preset_key = 'crystals') <> v_m.id then
    raise exception 'ARC-1 failure: overflow link lost';
  end if;
  if (select daily_reset_time from public.games where id = v_game) <> '05:00'::time
     or (select preset_version from public.games where id = v_game) <> 2 then
    raise exception 'ARC-1 failure: game reset time or version not updated';
  end if;

  -- A second tab sending the same version does nothing
  if public.sync_game_preset(v_game, (select body from arc1 where k = 'v2')) then
    raise exception 'ARC-1 failure: a game already on this version was synced again';
  end if;
end $$;

-- 4. A sync that fails halfway changes nothing
do $$
declare
  v_game uuid := (select id from arc1 where k = 'game');
  v_bad jsonb := jsonb_set(
    jsonb_set((select body from arc1 where k = 'v2'), '{version}', '3'),
    '{tasks}',
    (select body -> 'tasks' from arc1 where k = 'v2')
      || jsonb_build_array(jsonb_build_object('key', 'too-long', 'title', repeat('x', 81), 'frequency', 'daily')));
begin
  v_bad := jsonb_set(v_bad, '{tasks,1,title}', '"ZZ Should not stick"');
  begin
    perform public.sync_game_preset(v_game, v_bad);
    raise exception 'ARC-1 failure: an invalid preset was accepted';
  exception when check_violation then
    null; -- expected: the 81-character title breaks tasks_title_check
  end;
  if (select title from public.tasks where game_id = v_game and preset_key = 'daily') <> 'ZZ Daily (renamed)'
     or (select preset_version from public.games where id = v_game) <> 2 then
    raise exception 'ARC-1 failure: a failed sync left changes behind';
  end if;
end $$;

-- 5. Adding a game that fails leaves no half-made game
do $$
declare
  v_bad jsonb := jsonb_set((select body from arc1 where k = 'v1'), '{meters,1,cap}', '0');
begin
  v_bad := jsonb_set(v_bad, '{name}', '"ZZ ARC-1 broken"');
  begin
    perform public.add_game_from_preset(v_bad, 0);
    raise exception 'ARC-1 failure: a meter with cap 0 was accepted';
  exception when check_violation then
    null;
  end;
  if exists (select 1 from public.games where name = 'ZZ ARC-1 broken') then
    raise exception 'ARC-1 failure: a failed add left a game behind';
  end if;
end $$;

-- 6. Without a custom order, a sync puts tasks in preset order
do $$
declare
  v_game uuid := public.add_game_from_preset((select body from arc1 where k = 'v1'), 8);
begin
  perform public.sync_game_preset(v_game, (select body from arc1 where k = 'v2'));
  if (select string_agg(preset_key, ',' order by sort_order) from public.tasks where game_id = v_game and not archived)
     <> 'new,daily,opt,ends,target' then
    raise exception 'ARC-1 failure: preset order not applied to a game without a custom order';
  end if;
end $$;

-- 7. Another player cannot sync or even see this game
do $$
declare
  v_game uuid := (select id from arc1 where k = 'game');
begin
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    perform public.sync_game_preset(v_game, jsonb_set((select body from arc1 where k = 'v2'), '{version}', '9'));
    raise exception 'ARC-1 failure: another player synced this game';
  exception when raise_exception then
    if sqlerrm <> 'Game not found or access denied' then raise; end if;
  end;
end $$;

reset role;
do $$ begin raise notice 'ARC-1 passed: atomic add and sync, player settings kept, retries and failures leave no changes, other players blocked.'; end $$;

rollback;
