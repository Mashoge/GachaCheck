-- GAM-4: allow players to preserve a custom task order per game and reorder a
-- complete task group atomically. Preset sync respects the game-level override.

alter table public.games
  add column task_order_customized boolean not null default false;

create or replace function public.reorder_game_tasks(
  p_game_id uuid,
  p_task_ids uuid[]
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_category text;
  v_frequency text;
  v_expected_count integer;
  v_matched_count integer;
  v_distinct_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_task_ids is null or cardinality(p_task_ids) = 0 then
    raise exception 'At least one task is required';
  end if;

  select t.category, t.frequency
    into v_category, v_frequency
  from public.tasks as t
  where t.id = p_task_ids[1]
    and t.game_id = p_game_id
    and t.archived = false;

  if not found then
    raise exception 'Task does not belong to this game or is archived';
  end if;

  select count(distinct input.task_id), count(t.id)
    into v_distinct_count, v_matched_count
  from unnest(p_task_ids) as input(task_id)
  left join public.tasks as t
    on t.id = input.task_id
   and t.game_id = p_game_id
   and t.archived = false
   and t.category = v_category
   and (v_category <> 'routine' or t.frequency = v_frequency);

  select count(*)
    into v_expected_count
  from public.tasks as t
  where t.game_id = p_game_id
    and t.archived = false
    and t.category = v_category
    and (v_category <> 'routine' or t.frequency = v_frequency);

  if v_distinct_count <> cardinality(p_task_ids)
     or v_matched_count <> v_expected_count
     or v_expected_count <> cardinality(p_task_ids) then
    raise exception 'Task order must contain every active task in exactly one task group';
  end if;

  update public.tasks as t
  set sort_order = ordered.ordinality::integer - 1
  from unnest(p_task_ids) with ordinality as ordered(task_id, ordinality)
  where t.id = ordered.task_id
    and t.game_id = p_game_id
    and t.archived = false;

  update public.games
  set task_order_customized = true
  where id = p_game_id;

  if not found then
    raise exception 'Game not found or access denied';
  end if;
end;
$$;

revoke all on function public.reorder_game_tasks(uuid, uuid[]) from public;
grant execute on function public.reorder_game_tasks(uuid, uuid[]) to authenticated;
