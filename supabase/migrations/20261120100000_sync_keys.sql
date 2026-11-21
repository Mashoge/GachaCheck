-- STA-5: Genshin updates itself. A small helper on your PC (tools/genshin-sync) reads your HoYoLAB
-- Real-Time Notes every 15 minutes and sends GachaCheck two things: your Original Resin (and when it
-- will be full), and whether today's commissions are done. Your HoYoLAB login stays on your PC.
--
-- The helper has no GachaCheck login. Instead you create a helper key in the app (Games page). A key:
--   * is a long random secret ("gcs_" + 64 characters), shown to you once, when it is made;
--   * is stored only as its SHA-256 fingerprint, so even a copy of the database doesn't reveal it;
--   * can do exactly one thing: call public.sync_genshin, which sets the Resin meter and ticks the
--     "Daily commissions" task of your own Genshin game. It can't read anything, or change anything else;
--   * can be cancelled at any time (deleting it from the app); at most 3 per account.
--
-- Decided Nov 19, 2026 (opt-in): HoYoverse's terms broadly forbid unofficial automation; tools that
-- read Real-Time Notes say "use at your own risk" (no bans reported). The helper only reads what the
-- HoYoLAB website shows you, the same way the website asks for it, and never touches the game.
--
-- public.sync_genshin is the project's first function that runs with its owner's rights (security
-- definer), because the helper isn't signed in. It is written for that: an empty search_path with every
-- name in full, nothing granted by default, the key checked before anything else, every input checked,
-- and at most one call per key per minute.

-- ============================================================
-- 1. Helper keys
-- ============================================================
create table public.sync_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  label        text not null check (char_length(label) between 1 and 60),
  key_hash     text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),  -- SHA-256 of the key, in hex
  key_hint     text not null check (char_length(key_hint) = 4),         -- its last 4 characters, to tell keys apart
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  last_result  jsonb                                                      -- what the last sync did, shown in the app
);
create index sync_keys_user_id_idx on public.sync_keys (user_id);

comment on table public.sync_keys is
  'STA-5: keys for the PC helper that syncs Genshin from HoYoLAB. Only fingerprints are stored.';

alter table public.sync_keys enable row level security;

-- You see and delete (cancel) your own keys; making one goes through create_sync_key, so the key is
-- always random and only its fingerprint is saved.
create policy "Own sync keys: read" on public.sync_keys for select to authenticated using (user_id = auth.uid());
create policy "Own sync keys: cancel" on public.sync_keys for delete to authenticated using (user_id = auth.uid());

revoke all on public.sync_keys from public, anon, authenticated;
grant select (id, label, key_hint, created_at, last_used_at, last_result) on public.sync_keys to authenticated;
grant delete on public.sync_keys to authenticated;
grant select, insert, update, delete on public.sync_keys to service_role;

-- ============================================================
-- 2. Making a key (signed in): returns the key itself, once
-- ============================================================
create or replace function public.create_sync_key(p_label text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_label text := btrim(coalesce(p_label, ''));
  v_key text;
begin
  if v_user is null then
    raise exception 'Sign in to make a helper key.' using errcode = '28000';
  end if;
  if char_length(v_label) not between 1 and 60 then
    raise exception 'Give the key a name of 1 to 60 characters.' using errcode = '22023';
  end if;
  if (select count(*) from public.sync_keys where user_id = v_user) >= 3 then
    raise exception 'You already have 3 helper keys. Cancel one you no longer use first.' using errcode = '54000';
  end if;
  -- Two random UUIDs: 244 random bits, from the server's secure random source
  v_key := 'gcs_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.sync_keys (user_id, label, key_hash, key_hint)
  values (v_user, v_label, encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), right(v_key, 4));
  return v_key;
end;
$$;

-- ============================================================
-- 3. The sync itself (the helper, not signed in)
-- ============================================================
-- p_key          the helper key
-- p_resin        Original Resin now (0 to 2000: Resin can go past the cap with refills)
-- p_full_in      seconds until full, from HoYoLAB (0 when full); lines the refill countdown up exactly
-- p_commissions  true when all of today's commissions are done and the bonus is claimed
-- Returns what it did: { resin, commissions: ticked | already | not_done | no_task }, or { skipped: too_soon }.
create or replace function public.sync_genshin(p_key text, p_resin integer, p_full_in integer, p_commissions boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key   public.sync_keys;
  v_game  public.games;
  v_meter public.stamina_meters;
  v_task  uuid;
  v_now   timestamptz := now();
  v_local timestamp;
  v_start timestamp;
  v_day   timestamptz;
  v_secs  numeric;
  v_part  numeric := 0;
  v_done  text := 'not_done';
  v_result jsonb;
begin
  -- The key first: nothing else happens without a valid one
  if p_key is null or p_key !~ '^gcs_[0-9a-f]{64}$' then
    raise exception 'Not a valid helper key.' using errcode = '28000';
  end if;
  select * into v_key from public.sync_keys where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
  if not found then
    raise exception 'This helper key was cancelled or never existed. Make a new one on the Games page.' using errcode = '28000';
  end if;

  -- At most once a minute per key
  if v_key.last_used_at is not null and v_key.last_used_at > v_now - interval '1 minute' then
    return jsonb_build_object('skipped', 'too_soon');
  end if;

  if p_resin is null or p_resin not between 0 and 2000 then
    raise exception 'Resin must be a whole number from 0 to 2000.' using errcode = '22023';
  end if;
  if p_full_in is not null and p_full_in not between 0 and 604800 then
    raise exception 'Time until full must be between 0 seconds and a week.' using errcode = '22023';
  end if;

  select * into v_game from public.games
  where user_id = v_key.user_id and preset_id = 'genshin'
  order by created_at limit 1;
  if not found then
    raise exception 'There is no Genshin Impact game on your GachaCheck account.' using errcode = 'P0002';
  end if;

  -- Resin. The value is stamped so the app's refill count lines up with HoYoLAB's "full in": the time
  -- already spent on the next point is set back from now.
  select * into v_meter from public.stamina_meters where game_id = v_game.id and preset_key = 'resin';
  if found then
    v_secs := v_meter.minutes_per_point * 60;
    if p_full_in is not null and p_full_in > 0 and p_resin < v_meter.cap then
      v_part := greatest(0, least(v_secs - 1, (v_meter.cap - p_resin) * v_secs - p_full_in));
    end if;
    update public.stamina_meters
    set current_value = p_resin, value_recorded_at = v_now - make_interval(secs => v_part)
    where id = v_meter.id;
  end if;

  -- Commissions: ticked once for today (the game's day, from its daily reset), like the app does
  select id into v_task from public.tasks
  where game_id = v_game.id and preset_key = 'commissions' and not archived
  limit 1;
  if v_task is null then
    v_done := 'no_task';
  elsif coalesce(p_commissions, false) then
    v_local := v_now at time zone v_game.timezone;
    v_start := v_local::date + date_trunc('minute', v_game.daily_reset_time::interval);
    if v_start > v_local then
      v_start := v_start - interval '1 day';
    end if;
    v_day := v_start at time zone v_game.timezone;
    insert into public.completions (user_id, task_id, period_start, completed_at)
    values (v_key.user_id, v_task, v_day, v_now)
    on conflict (task_id, period_start) do nothing;
    v_done := case when found then 'ticked' else 'already' end;
  end if;

  v_result := jsonb_build_object('resin', p_resin, 'commissions', v_done, 'at', v_now);
  update public.sync_keys set last_used_at = v_now, last_result = v_result where id = v_key.id;
  return v_result;
end;
$$;

-- Functions are callable by everyone unless taken away: start from nothing, then grant only these
revoke all on function public.create_sync_key(text) from public, anon, authenticated;
revoke all on function public.sync_genshin(text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.create_sync_key(text) to authenticated;
grant execute on function public.sync_genshin(text, integer, integer, boolean) to anon, authenticated;
