-- ARC-1: add a game, or bring it in line with a newer preset, all or nothing.
--
-- Before this, the app did it in many separate writes (game, each task, each meter, then the version).
-- A dropped connection halfway left a game half synced. Now each is one function call, so one
-- transaction: either every change is saved or none is, and the next load simply tries again.
--
-- The app sends the preset (src/data/presets.ts) as JSON, already set to the chosen server:
--   { preset_id, version, name, server, timezone, daily_reset_time, weekly_reset_day,
--     tasks:  [{ key, title, frequency, category, optional, note, monthly_day, cycle_anchor,
--                cycle_days, cycle_ends_at, weekly_target? }],      -- in preset order
--     meters: [{ key, name, cap, minutes_per_point, fills_when_full_of_key }] }
--
-- The rules are the ones the app used, unchanged:
-- * Hidden flags are never changed by a sync. A new optional task starts hidden.
-- * Tasks you added yourself (no preset_key) are never touched.
-- * If you reordered tasks (games.task_order_customized), your order is kept and new preset tasks
--   go after your last one. Otherwise tasks follow the preset order.
-- * An end date you entered (cycle_ends_at) is kept unless the preset has a later one, and the
--   cycle's start day stays with it unless the preset sets one.
-- * weekly_target is only overwritten when the preset defines one (the key is in the JSON).
-- * Preset tasks no longer in the preset are archived, so their history is kept.
-- * Meters keep their current value, ping threshold (ping_at) and spend buttons; only name, cap,
--   refill rate, order and overflow link come from the preset. Meters not in the preset are removed.
-- * preset_version is saved with everything else, so a failed sync is retried on the next load.
--
-- Both functions run as the signed-in player (security invoker), so row-level security applies to
-- every write exactly as it did for the app's own writes.

create or replace function public.sync_game_preset(p_game_id uuid, p_preset jsonb)
returns boolean -- true = the game was synced; false = it was already on this version
language plpgsql
set search_path = public
as $$
declare
  v_game public.games;
  v_version integer;
  v_next_order integer;
  v_meter record;
  v_target uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_version := (p_preset ->> 'version')::integer;
  if v_version is null
     or coalesce(p_preset ->> 'preset_id', '') = ''
     or coalesce(p_preset ->> 'server', '') = ''
     or coalesce(p_preset ->> 'timezone', '') = ''
     or jsonb_typeof(p_preset -> 'tasks') is distinct from 'array'
     or jsonb_typeof(p_preset -> 'meters') is distinct from 'array'
     or exists (select 1 from jsonb_array_elements(p_preset -> 'tasks') as e(v) where coalesce(e.v ->> 'key', '') = '')
     or exists (select 1 from jsonb_array_elements(p_preset -> 'meters') as e(v) where coalesce(e.v ->> 'key', '') = '') then
    raise exception 'Preset data is incomplete';
  end if;

  -- Lock the game so two open tabs syncing at once take turns instead of both inserting tasks
  select * into v_game from public.games where id = p_game_id for update;
  if not found then
    raise exception 'Game not found or access denied';
  end if;
  if v_game.preset_id is distinct from p_preset ->> 'preset_id' then
    raise exception 'This game was not added from the % preset', p_preset ->> 'preset_id';
  end if;
  if coalesce(v_game.preset_version, 0) >= v_version then
    return false; -- another tab already did it
  end if;

  -- ---------- Tasks ----------
  -- Where new preset tasks go when your own order is kept: after every active task
  select coalesce(max(sort_order), -1) + 1 into v_next_order
  from public.tasks where game_id = p_game_id and not archived;

  update public.tasks as t
  set title         = p.title,
      frequency     = p.frequency,
      category      = coalesce(p.category, 'routine'),
      optional      = coalesce(p.optional, false),
      note          = p.note,
      monthly_day   = p.monthly_day,
      cycle_days    = p.cycle_days,
      cycle_anchor  = coalesce(p.cycle_anchor, t.cycle_anchor),
      cycle_ends_at = case
                        when t.cycle_ends_at is null then p.cycle_ends_at
                        when p.cycle_ends_at is null then t.cycle_ends_at
                        when date_trunc('minute', t.cycle_ends_at) >= date_trunc('minute', p.cycle_ends_at) then t.cycle_ends_at
                        else p.cycle_ends_at
                      end,
      weekly_target = case when p.raw ? 'weekly_target' then p.weekly_target else t.weekly_target end,
      sort_order    = case when v_game.task_order_customized then t.sort_order else p.ord end,
      archived      = false
  from (
    select x.*, e.v as raw, (e.n - 1)::integer as ord
    from jsonb_array_elements(p_preset -> 'tasks') with ordinality as e(v, n)
    cross join lateral jsonb_to_record(e.v) as x(
      key text, title text, frequency text, category text, optional boolean, note text,
      monthly_day smallint, cycle_anchor date, cycle_days smallint, cycle_ends_at timestamp, weekly_target smallint)
  ) as p
  where t.game_id = p_game_id and t.preset_key = p.key;

  insert into public.tasks (
    user_id, game_id, preset_key, title, frequency, category, optional, hidden, note,
    monthly_day, cycle_anchor, cycle_days, cycle_ends_at, weekly_target, sort_order)
  select v_game.user_id, p_game_id, p.key, p.title, p.frequency, coalesce(p.category, 'routine'),
         coalesce(p.optional, false), coalesce(p.optional, false), p.note,
         p.monthly_day, p.cycle_anchor, p.cycle_days, p.cycle_ends_at, p.weekly_target,
         case when v_game.task_order_customized
              then v_next_order + (row_number() over (order by p.ord))::integer - 1
              else p.ord end
  from (
    select x.*, (e.n - 1)::integer as ord
    from jsonb_array_elements(p_preset -> 'tasks') with ordinality as e(v, n)
    cross join lateral jsonb_to_record(e.v) as x(
      key text, title text, frequency text, category text, optional boolean, note text,
      monthly_day smallint, cycle_anchor date, cycle_days smallint, cycle_ends_at timestamp, weekly_target smallint)
  ) as p
  where not exists (select 1 from public.tasks as t where t.game_id = p_game_id and t.preset_key = p.key);

  update public.tasks as t
  set archived = true
  where t.game_id = p_game_id
    and t.preset_key is not null
    and not t.archived
    and not exists (select 1 from jsonb_array_elements(p_preset -> 'tasks') as e(v) where e.v ->> 'key' = t.preset_key);

  -- ---------- Stamina meters ----------
  -- Normal meters first, so an overflow meter can point at the meter that must be full first
  for v_meter in
    select m.key, m.name, m.cap, m.minutes_per_point, m.fills_when_full_of_key, (e.n - 1)::integer as ord
    from jsonb_array_elements(p_preset -> 'meters') with ordinality as e(v, n)
    cross join lateral jsonb_to_record(e.v) as m(
      key text, name text, cap integer, minutes_per_point numeric, fills_when_full_of_key text)
    order by (m.fills_when_full_of_key is not null), e.n
  loop
    v_target := null;
    if v_meter.fills_when_full_of_key is not null then
      select id into v_target from public.stamina_meters
      where game_id = p_game_id and preset_key = v_meter.fills_when_full_of_key;
    end if;

    update public.stamina_meters
    set name = v_meter.name,
        cap = v_meter.cap,
        minutes_per_point = v_meter.minutes_per_point,
        sort_order = v_meter.ord,
        fills_when_full_of = v_target
    where game_id = p_game_id and preset_key = v_meter.key;

    if not found then
      insert into public.stamina_meters (user_id, game_id, preset_key, name, cap, minutes_per_point, sort_order, fills_when_full_of)
      values (v_game.user_id, p_game_id, v_meter.key, v_meter.name, v_meter.cap, v_meter.minutes_per_point, v_meter.ord, v_target);
    end if;
  end loop;

  delete from public.stamina_meters as m
  where m.game_id = p_game_id
    and (m.preset_key is null
         or not exists (select 1 from jsonb_array_elements(p_preset -> 'meters') as e(v) where e.v ->> 'key' = m.preset_key));

  -- ---------- The game itself, and the version, together ----------
  update public.games
  set name             = p_preset ->> 'name',
      server           = p_preset ->> 'server',
      timezone         = p_preset ->> 'timezone',
      daily_reset_time = (p_preset ->> 'daily_reset_time')::time,
      weekly_reset_day = (p_preset ->> 'weekly_reset_day')::smallint,
      preset_version   = v_version
  where id = p_game_id;

  return true;
end;
$$;

revoke all on function public.sync_game_preset(uuid, jsonb) from public, anon;
grant execute on function public.sync_game_preset(uuid, jsonb) to authenticated;

-- Add a game from a preset with its tasks and meters. If anything fails, no game is left behind.
create or replace function public.add_game_from_preset(p_preset jsonb, p_sort_order integer)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  insert into public.games (user_id, name, server, timezone, daily_reset_time, weekly_reset_day, preset_id, preset_version, sort_order)
  values (
    auth.uid(),
    p_preset ->> 'name',
    p_preset ->> 'server',
    p_preset ->> 'timezone',
    (p_preset ->> 'daily_reset_time')::time,
    (p_preset ->> 'weekly_reset_day')::smallint,
    p_preset ->> 'preset_id',
    0,
    coalesce(p_sort_order, 0))
  returning id into v_id;

  perform public.sync_game_preset(v_id, p_preset);
  return v_id;
end;
$$;

revoke all on function public.add_game_from_preset(jsonb, integer) from public, anon;
grant execute on function public.add_game_from_preset(jsonb, integer) to authenticated;
