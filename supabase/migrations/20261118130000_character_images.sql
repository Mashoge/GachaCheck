-- LTR-8: your own character pictures for each game, shown on the Today roster cards (THM-6).
--
-- The files live in a private Storage bucket, one folder per player: character-art/<user id>/<game id>/<file>.
-- Only the owner can read or write their folder (policies below), and the app shows pictures through
-- short-lived signed links, so nothing is public. The app itself ships no game art: these are the player's
-- own screenshots, shrunk in the browser before upload (WebP or JPEG, at most 1 MB each).
--
-- character_images keeps one row per picture: which game, its order, and the point to keep in view
-- when the card crops it (focus_x / focus_y, percent from the left / top, used as CSS object-position).

-- ---------- Storage bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('character-art', 'character-art', false, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Only your own folder (the first part of the path is your user id)
create policy "Owner reads own character art" on storage.objects
  for select to authenticated
  using (bucket_id = 'character-art' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Owner uploads own character art" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'character-art' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Owner updates own character art" on storage.objects
  for update to authenticated
  using (bucket_id = 'character-art' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'character-art' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Owner deletes own character art" on storage.objects
  for delete to authenticated
  using (bucket_id = 'character-art' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------- Picture list ----------
create table public.character_images (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  game_id    uuid not null references public.games (id) on delete cascade,
  path       text not null unique,      -- inside the character-art bucket
  focus_x    smallint not null default 50 check (focus_x between 0 and 100),
  focus_y    smallint not null default 35 check (focus_y between 0 and 100),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  -- The file must sit in this player's folder for this game
  constraint character_images_path_check
    check (path like user_id::text || '/' || game_id::text || '/%' and char_length(path) <= 200)
);

create index character_images_game_idx on public.character_images (game_id, sort_order);

alter table public.character_images enable row level security;

create policy "Owner manages own character images" on public.character_images
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.games g where g.id = game_id and g.user_id = (select auth.uid()))
  );

grant select, insert, update, delete on public.character_images to authenticated;

-- A few favourites per game, not a gallery: at most 12 pictures per game
create or replace function public.character_images_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Lock the game row so two uploads at once cannot both pass the count
  perform 1 from public.games where id = new.game_id for update;
  if (select count(*) from public.character_images where game_id = new.game_id) >= 12 then
    raise exception 'A game can have at most 12 character pictures' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger character_images_limit
  before insert on public.character_images
  for each row execute function public.character_images_limit();
