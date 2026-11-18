-- LTR-8 (second half): your own icon for each game, shown next to its name on Today, the game page
-- and the Games screen. Like character pictures, it is your own upload in the private character-art
-- bucket (own folder only, signed links); the app ships no official game art. Without an icon a game
-- keeps its coloured badge.
--
-- games already has row-level security ("Owner manages own games") and table-wide grants. The preset
-- sync (sync_game_preset, ARC-1) does not touch this column, so an icon survives preset updates.

alter table public.games
  add column icon_path text
    constraint games_icon_path_check
    check (icon_path is null
           or (icon_path like user_id::text || '/' || id::text || '/icon-%' and char_length(icon_path) <= 200));
