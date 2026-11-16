-- GAM-4 scenario test for atomic task ordering and row-level security.
-- Run after 20261116100000_gam4_task_management.sql in the Supabase SQL Editor.
-- Uses temporary game/task rows and rolls the whole transaction back at the end.

begin;

create temporary table gam4_test_ids (
  user_id uuid not null,
  game_id uuid not null,
  daily_a uuid not null,
  daily_b uuid not null,
  daily_c uuid not null,
  weekly_task uuid not null
);
grant select on gam4_test_ids to authenticated;

do $$
declare
  v_user uuid;
  v_game uuid;
  v_daily_a uuid := gen_random_uuid();
  v_daily_b uuid := gen_random_uuid();
  v_daily_c uuid := gen_random_uuid();
  v_weekly uuid := gen_random_uuid();
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then
    raise exception 'Create or use a signed-in account before running the GAM-4 scenario test.';
  end if;

  insert into public.games (user_id, name)
  values (v_user, 'ZZ GAM-4 task-order test')
  returning id into v_game;

  insert into public.tasks (id, user_id, game_id, title, frequency, category, sort_order)
  values
    (v_daily_a, v_user, v_game, 'ZZ Daily A', 'daily', 'routine', 10),
    (v_daily_b, v_user, v_game, 'ZZ Daily B', 'daily', 'routine', 20),
    (v_daily_c, v_user, v_game, 'ZZ Daily C', 'daily', 'routine', 30),
    (v_weekly, v_user, v_game, 'ZZ Weekly', 'weekly', 'routine', 77);

  insert into gam4_test_ids values (v_user, v_game, v_daily_a, v_daily_b, v_daily_c, v_weekly);
end $$;

-- Simulate the user's authenticated JWT so the function runs under normal RLS policies.
select set_config('request.jwt.claim.sub', user_id::text, true) from gam4_test_ids;
select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true)
from gam4_test_ids;
set local role authenticated;

-- Move the daily tasks to C, A, B. The weekly task is not part of this reorder.
select public.reorder_game_tasks(
  (select game_id from gam4_test_ids),
  array[
    (select daily_c from gam4_test_ids),
    (select daily_a from gam4_test_ids),
    (select daily_b from gam4_test_ids)
  ]
);

-- Mixed groups must be rejected before any row is changed.
do $$
begin
  begin
    perform public.reorder_game_tasks(
      (select game_id from gam4_test_ids),
      array[
        (select daily_a from gam4_test_ids),
        (select weekly_task from gam4_test_ids)
      ]
    );
    raise exception 'GAM-4 failure: mixed daily/weekly task groups were accepted';
  exception when raise_exception then
    if sqlerrm not like 'Task order must contain every active task in exactly one task group' then
      raise;
    end if;
  end;
end $$;

reset role;

do $$
declare
  v_game uuid;
  v_order text;
  v_weekly_order integer;
  v_customized boolean;
begin
  select game_id into v_game from gam4_test_ids;

  select string_agg(title, ', ' order by sort_order)
    into v_order
  from public.tasks
  where game_id = v_game and frequency = 'daily' and category = 'routine' and not archived;

  if v_order <> 'ZZ Daily C, ZZ Daily A, ZZ Daily B' then
    raise exception 'GAM-4 failure: expected C, A, B; received %', v_order;
  end if;

  select sort_order into v_weekly_order
  from public.tasks where game_id = v_game and title = 'ZZ Weekly';
  if v_weekly_order <> 77 then
    raise exception 'GAM-4 failure: weekly task order changed unexpectedly';
  end if;

  select task_order_customized into v_customized from public.games where id = v_game;
  if v_customized is distinct from true then
    raise exception 'GAM-4 failure: game order override was not saved';
  end if;

  raise notice 'GAM-4 passed: authenticated reorder, group isolation, atomic validation, and preset-order flag.';
end $$;

rollback;
