-- Events added automatically from the Genshin announcement feed.

alter table public.events
  add column source      text not null default 'manual' check (source in ('manual', 'genshin_feed')),
  add column external_id text,                            -- e.g. 'genshin:21974'; null for events you add
  add column hidden      boolean not null default false,  -- hidden imported events are never added again
  add constraint events_user_external_key unique (user_id, external_id);  -- each notice is added once

alter table public.user_settings
  add column last_event_import_at timestamptz;  -- the feed is read at most once a day
