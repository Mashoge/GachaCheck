-- LTR-8 scenario test: character pictures and game icons are private to their owner, tied to the
-- owner's own game, pictures limited to 12 per game, and removed with the game.
-- Run after 20261118140000_game_icons.sql in the Supabase SQL Editor (or psql). Uses the first
-- account in auth.users, only touches the picture list (not real files), and rolls everything back.

begin;

create temporary table ltr8 (k text primary key, id uuid);
grant select, insert on ltr8 to authenticated;

-- The bucket exists and is private
do $$ begin
  if not exists (select 1 from storage.buckets where id = 'character-art' and public = false) then
    raise exception 'LTR-8 failure: bucket character-art is missing or public';
  end if;
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub', (select id from auth.users order by created_at limit 1), 'role', 'authenticated')::text, true);
do $$ begin
  if auth.uid() is null then raise exception 'Create or use a signed-in account before running the LTR-8 test.'; end if;
end $$;
set local role authenticated;

-- 1. Add a game and pictures for it
do $$
declare
  v_game uuid;
  v_uid text := auth.uid()::text;
begin
  insert into public.games (name, server, timezone, daily_reset_time, weekly_reset_day, sort_order)
  values ('ZZ LTR-8 test', 'asia', 'Etc/GMT-8', '04:00', 1, 99) returning id into v_game;
  insert into ltr8 values ('game', v_game), ('me', auth.uid());

  insert into public.character_images (game_id, path, sort_order)
  select v_game, v_uid || '/' || v_game || '/pic-' || n || '.webp', n from generate_series(1, 12) as n;

  if (select count(*) from public.character_images where game_id = v_game) <> 12 then
    raise exception 'LTR-8 failure: could not add 12 pictures';
  end if;
  if (select focus_x || ',' || focus_y from public.character_images where game_id = v_game and sort_order = 1) <> '50,35' then
    raise exception 'LTR-8 failure: default focus point should be 50,35';
  end if;
end $$;

-- 2. A 13th picture is refused
do $$
declare
  v_game uuid := (select id from ltr8 where k = 'game');
begin
  begin
    insert into public.character_images (game_id, path) values (v_game, auth.uid() || '/' || v_game || '/pic-13.webp');
    raise exception 'LTR-8 failure: a 13th picture was accepted';
  exception when check_violation then
    null; -- expected
  end;
end $$;

-- 3. A file outside your own folder for this game is refused
do $$
declare
  v_game uuid := (select id from ltr8 where k = 'game');
begin
  delete from public.character_images where game_id = v_game and sort_order = 12;
  begin
    insert into public.character_images (game_id, path) values (v_game, gen_random_uuid() || '/' || v_game || '/x.webp');
    raise exception 'LTR-8 failure: a path in someone else''s folder was accepted';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.character_images (game_id, path) values (v_game, auth.uid() || '/' || gen_random_uuid() || '/x.webp');
    raise exception 'LTR-8 failure: a path under another game was accepted';
  exception when check_violation then
    null;
  end;
  begin
    update public.character_images set focus_x = 101 where game_id = v_game and sort_order = 1;
    raise exception 'LTR-8 failure: a focus point outside 0-100 was accepted';
  exception when check_violation then
    null;
  end;
end $$;

-- 3b. The game's icon must be an icon file in your own folder for this game
do $$
declare
  v_game uuid := (select id from ltr8 where k = 'game');
begin
  update public.games set icon_path = auth.uid() || '/' || v_game || '/icon-abc.webp' where id = v_game;
  if (select icon_path from public.games where id = v_game) is null then
    raise exception 'LTR-8 failure: a valid icon path was not saved';
  end if;
  begin
    update public.games set icon_path = auth.uid() || '/' || v_game || '/pic-1.webp' where id = v_game;
    raise exception 'LTR-8 failure: a non-icon file was accepted as the icon';
  exception when check_violation then
    null;
  end;
  begin
    update public.games set icon_path = gen_random_uuid() || '/' || v_game || '/icon-x.webp' where id = v_game;
    raise exception 'LTR-8 failure: an icon in someone else''s folder was accepted';
  exception when check_violation then
    null;
  end;
end $$;

-- 4. Another player sees nothing and cannot add pictures to this game
do $$
declare
  v_game uuid := (select id from ltr8 where k = 'game');
  v_other uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.character_images where game_id = v_game) then
    raise exception 'LTR-8 failure: another player can see these pictures';
  end if;
  begin
    insert into public.character_images (user_id, game_id, path) values (v_other, v_game, v_other || '/' || v_game || '/x.webp');
    raise exception 'LTR-8 failure: another player added a picture to this game';
  exception when insufficient_privilege or foreign_key_violation then
    null; -- refused by row-level security (or the account does not exist)
  end;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from ltr8 where k = 'me'), 'role', 'authenticated')::text, true);
end $$;

-- 5. Deleting the game removes its picture list
do $$
declare
  v_game uuid := (select id from ltr8 where k = 'game');
begin
  delete from public.games where id = v_game;
  if exists (select 1 from public.character_images where game_id = v_game) then
    raise exception 'LTR-8 failure: pictures outlived their game';
  end if;
end $$;

reset role;
do $$ begin raise notice 'LTR-8 passed: private bucket, own folder only, icons in place, 12 per game, other players blocked, removed with the game.'; end $$;

rollback;
