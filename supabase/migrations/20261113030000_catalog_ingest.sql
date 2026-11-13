-- Catalog ingest (step 2 of the collector work).
-- One database function does every write for a collector run, so a run is all or nothing:
-- if anything fails, nothing from that run is saved. The "ingest" Edge Function checks the
-- collector's secret and the shape of the data, then calls this function.
-- Purely additive: one small table (the trust rules) and three functions, callable only by the server role.
-- The payload contract is documented in supabase/functions/ingest/README.md.

-- ============================================================
-- catalog_name_key: the normalised name used to match events
-- "Hunter's Crucible" and "[Hunters Crucible]" both become "hunters crucible"
-- ============================================================
create function public.catalog_name_key(name text) returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select left(coalesce(
    nullif(trim(regexp_replace(
      regexp_replace(lower(normalize(name, NFKC)), '[''’`]', '', 'g'),   -- drop apostrophes
      '[^a-z0-9]+', ' ', 'g')), ''),                                      -- anything else is a space
    lower(trim(name))                                                     -- names with no Latin letters
  ), 120)
$$;

-- ============================================================
-- catalog_trust_rules: which sources may confirm events without a review
-- A new event is confirmed automatically only when ALL of these hold:
--   - the collector marked it trusted (its parser matched the expected pattern),
--   - it has an end date,
--   - a rule here allows that source, article type and event kind.
-- Anything else is saved as 'needs_review'. Rules change only through a migration.
-- ============================================================
create table public.catalog_trust_rules (
  source       text not null check (source ~ '^[a-z0-9_]{1,40}$'),
  article_kind text not null,
  kind         text not null check (kind in ('event', 'web_event', 'banner', 'endgame_cycle')),
  note         text check (char_length(note) <= 200),
  created_at   timestamptz not null default now(),
  primary key (source, article_kind, kind)
);

insert into public.catalog_trust_rules (source, article_kind, kind, note) values
  ('wuwa_official_site', 'patch_notes', 'event',         'Events with full dates in the official Patch Notes'),
  ('wuwa_official_site', 'patch_notes', 'web_event',     'Web events listed in the official Patch Notes'),
  ('wuwa_official_site', 'patch_notes', 'endgame_cycle', 'Endstate Matrix end date in the Patch Notes'),
  ('nte_official_site',  'patch_notes', 'event',         'Events in the official NTE patch notes'),
  ('nte_official_site',  'patch_notes', 'web_event',     'Web events in the official NTE patch notes');

alter table public.catalog_trust_rules enable row level security;

create policy "Admins read trust rules" on public.catalog_trust_rules
  for select to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = (select auth.uid())));

revoke all on public.catalog_trust_rules from public, anon, authenticated, service_role;
grant select on public.catalog_trust_rules to authenticated, service_role;

-- ============================================================
-- catalog_ingest_apply: save one collector run (called through catalog_ingest below)
--
-- p is the payload the Edge Function has already validated:
--   { source, game, articles: [ { external_id, title, url, article_kind, published_at,
--       content_hash, complete, observations: [ { observed_key, kind, version, server_scope,
--       name, occurrence_key, starts_local, ends_local, time_basis, utc_offset_minutes,
--       start_rule, official_url, task_preset_key, raw_text, trusted } ] } ] }
--
-- Rules for each observation:
--   1. Find its event: first by (article, observed_key), so an edited date keeps its event;
--      then by the event identity; otherwise it is a new event.
--   2. New event: 'confirmed' only if it passes the trust policy above, otherwise 'needs_review'.
--   3. Existing event with the same dates: nothing changes except last_seen_at.
--   4. Different dates:
--        rejected event        -> left alone ('ignored')
--        locked by a reviewer  -> left alone, observation flagged as a conflict
--        another current source disagrees -> left alone, flagged, event sent to review
--        otherwise             -> event updated to the new dates
--   5. An article marked complete: its observations that are no longer listed get missing_since.
--      The collector may set complete only after the article was fetched and fully parsed.
-- ============================================================
create function public.catalog_ingest_apply(p jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_source  text := p ->> 'source';
  v_game    text := p ->> 'game';
  art       jsonb;
  obs       jsonb;
  v_art_id  bigint;
  v_art_new boolean;
  v_hash_changed boolean;
  v_keys    text[];
  ev        public.catalog_events%rowtype;
  v_event_id uuid;
  v_name_key text;
  v_found_by text;
  v_status   text;
  v_differs  boolean;
  v_action   text;
  v_conflict boolean;
  v_missing  int;
  o_starts timestamp; o_ends timestamp; o_basis text; o_offset smallint; o_rule text;
  items    jsonb := '[]'::jsonb;
  counts   jsonb := jsonb_build_object('created', 0, 'updated', 0, 'unchanged', 0, 'conflict', 0,
                                       'ignored', 0, 'skipped', 0, 'missing', 0,
                                       'articles_new', 0, 'articles_changed', 0);
begin
  -- One run at a time, so two overlapping runs cannot both create the same event
  perform pg_advisory_xact_lock(hashtext('public.catalog_ingest'));

  for art in select * from jsonb_array_elements(p -> 'articles')
  loop
    -- ---------- the article ----------
    select content_hash is distinct from (art ->> 'content_hash')
      into v_hash_changed
      from public.source_articles
     where source = v_source and external_id = art ->> 'external_id';
    v_art_new := not found;

    if v_art_new then
      counts := jsonb_set(counts, '{articles_new}', to_jsonb((counts ->> 'articles_new')::int + 1));
    elsif v_hash_changed then
      counts := jsonb_set(counts, '{articles_changed}', to_jsonb((counts ->> 'articles_changed')::int + 1));
    end if;

    insert into public.source_articles as sa
      (game, source, external_id, title, url, article_kind, published_at, content_hash, last_changed_at)
    values
      (v_game, v_source, art ->> 'external_id', art ->> 'title', art ->> 'url',
       coalesce(art ->> 'article_kind', 'other'), (art ->> 'published_at')::timestamptz,
       art ->> 'content_hash', now())
    on conflict (source, external_id) do update set
      title           = excluded.title,
      url             = coalesce(excluded.url, sa.url),
      article_kind    = excluded.article_kind,
      published_at    = coalesce(excluded.published_at, sa.published_at),
      content_hash    = excluded.content_hash,
      last_seen_at    = now(),
      last_changed_at = case when sa.content_hash is distinct from excluded.content_hash
                             then now() else sa.last_changed_at end
    returning id into v_art_id;

    v_keys := '{}';

    -- ---------- each observation ----------
    for obs in select * from jsonb_array_elements(coalesce(art -> 'observations', '[]'::jsonb))
    loop
      v_keys     := v_keys || (obs ->> 'observed_key');
      v_name_key := public.catalog_name_key(obs ->> 'name');
      o_starts   := (obs ->> 'starts_local')::timestamp;
      o_ends     := (obs ->> 'ends_local')::timestamp;
      o_basis    := coalesce(obs ->> 'time_basis', 'server_local');
      o_offset   := (obs ->> 'utc_offset_minutes')::smallint;
      o_rule     := coalesce(obs ->> 'start_rule', 'exact');
      v_event_id := null;
      v_found_by := null;
      v_conflict := false;

      -- 1. by this article's own key (keeps an edited date on the same event)
      select event_id into v_event_id
        from public.catalog_event_sources
       where article_id = v_art_id and observed_key = obs ->> 'observed_key';
      if v_event_id is not null then v_found_by := 'key'; end if;

      -- 2. by the event identity
      if v_event_id is null then
        select id into v_event_id
          from public.catalog_events
         where game = v_game
           and version = coalesce(obs ->> 'version', '')
           and kind = obs ->> 'kind'
           and server_scope = coalesce(obs ->> 'server_scope', 'all')
           and name_key = v_name_key
           and occurrence_key = coalesce(obs ->> 'occurrence_key', '');
        if v_event_id is not null then v_found_by := 'identity'; end if;
      end if;

      if v_event_id is null then
        -- ---------- a new event ----------
        v_action := 'created';
        v_status := case
          when coalesce((obs ->> 'trusted')::boolean, false)
               and o_ends is not null
               and exists (select 1 from public.catalog_trust_rules r
                            where r.source = v_source
                              and r.article_kind = coalesce(art ->> 'article_kind', 'other')
                              and r.kind = obs ->> 'kind')
          then 'confirmed' else 'needs_review' end;
        insert into public.catalog_events
          (game, version, kind, server_scope, name, name_key, occurrence_key,
           starts_local, ends_local, time_basis, utc_offset_minutes, start_rule,
           official_url, task_preset_key, status)
        values
          (v_game, coalesce(obs ->> 'version', ''), obs ->> 'kind', coalesce(obs ->> 'server_scope', 'all'),
           obs ->> 'name', v_name_key, coalesce(obs ->> 'occurrence_key', ''),
           o_starts, o_ends, o_basis, o_offset, o_rule,
           obs ->> 'official_url', obs ->> 'task_preset_key', v_status)
        returning id into v_event_id;

      else
        -- ---------- an event we already have ----------
        select * into ev from public.catalog_events where id = v_event_id;

        -- This article already reports that event under a different key: the collector should
        -- have merged them. Skip it rather than guess which one is right.
        if v_found_by = 'identity' and exists (
             select 1 from public.catalog_event_sources
              where event_id = v_event_id and article_id = v_art_id
                and observed_key <> obs ->> 'observed_key') then
          v_action := 'skipped';
          items := items || jsonb_build_object('article', art ->> 'external_id', 'key', obs ->> 'observed_key',
                     'action', v_action, 'event_id', v_event_id,
                     'reason', 'this article already reports this event under another key');
          counts := jsonb_set(counts, '{skipped}', to_jsonb((counts ->> 'skipped')::int + 1));
          continue;
        end if;

        v_differs := (ev.starts_local, ev.ends_local, ev.time_basis, ev.utc_offset_minutes, ev.start_rule)
                     is distinct from (o_starts, o_ends, o_basis, o_offset, o_rule);

        if ev.status = 'rejected' then
          v_action := 'ignored';
        elsif not v_differs then
          v_action := 'unchanged';
        elsif ev.locked_at is not null then
          v_action := 'conflict';
          v_conflict := true;
        elsif exists (
            select 1 from public.catalog_event_sources s
             where s.event_id = v_event_id
               and s.article_id is distinct from v_art_id
               and s.missing_since is null
               and not s.conflict
               and (s.observed_starts_local, s.observed_ends_local, s.observed_time_basis,
                    s.observed_utc_offset_minutes, s.observed_start_rule)
                   is distinct from (o_starts, o_ends, o_basis, o_offset, o_rule)) then
          v_action := 'conflict';
          v_conflict := true;
          if ev.status <> 'needs_review' then
            update public.catalog_events set status = 'needs_review',
                   review_note = left('Sources disagree on the dates. ' || coalesce(review_note, ''), 300)
             where id = v_event_id;
          end if;
        else
          v_action := 'updated';
          update public.catalog_events set
            starts_local       = o_starts,
            ends_local         = o_ends,
            time_basis         = o_basis,
            utc_offset_minutes = o_offset,
            start_rule         = o_rule,
            official_url       = coalesce(obs ->> 'official_url', official_url)
           where id = v_event_id;
        end if;
      end if;

      -- ---------- what this article said ----------
      insert into public.catalog_event_sources as s
        (event_id, article_id, observed_key, observed_name, observed_starts_local, observed_ends_local,
         observed_time_basis, observed_utc_offset_minutes, observed_start_rule, raw_text, conflict)
      values
        (v_event_id, v_art_id, obs ->> 'observed_key', obs ->> 'name', o_starts, o_ends,
         o_basis, o_offset, o_rule, left(obs ->> 'raw_text', 500), v_conflict)
      on conflict (article_id, observed_key) do update set
        observed_name               = excluded.observed_name,
        observed_starts_local       = excluded.observed_starts_local,
        observed_ends_local         = excluded.observed_ends_local,
        observed_time_basis         = excluded.observed_time_basis,
        observed_utc_offset_minutes = excluded.observed_utc_offset_minutes,
        observed_start_rule         = excluded.observed_start_rule,
        raw_text                    = excluded.raw_text,
        conflict                    = excluded.conflict,
        missing_since               = null,
        last_seen_at                = now();

      counts := jsonb_set(counts, array[v_action], to_jsonb((counts ->> v_action)::int + 1));
      items := items || jsonb_build_object('article', art ->> 'external_id', 'key', obs ->> 'observed_key',
                 'action', v_action, 'event_id', v_event_id, 'name', obs ->> 'name',
                 'status', case when v_action = 'created' then v_status end);
    end loop;

    -- ---------- observations this article no longer lists ----------
    -- Only for an article the collector fetched and parsed in full (see the README)
    if coalesce((art ->> 'complete')::boolean, false) then
      update public.catalog_event_sources set missing_since = now()
       where article_id = v_art_id and missing_since is null and not (observed_key = any (v_keys));
      get diagnostics v_missing = row_count;
      counts := jsonb_set(counts, '{missing}', to_jsonb((counts ->> 'missing')::int + v_missing));
    end if;
  end loop;

  return jsonb_build_object('counts', counts, 'items', items);
end;
$$;

-- ============================================================
-- catalog_ingest: the entry point the Edge Function calls
-- p_dry = true runs the real write path, then rolls all of it back, so a dry run reports
-- exactly what a real run would do (new articles, key matches, missing observations, conflicts)
-- and leaves nothing behind. Only side effect: the article id counter moves on.
-- ============================================================
create function public.catalog_ingest(p jsonb, p_dry boolean default false) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not p_dry then
    return public.catalog_ingest_apply(p) || jsonb_build_object('dry_run', false);
  end if;

  begin
    result := public.catalog_ingest_apply(p);
    raise exception using errcode = 'GC001', message = 'dry run: rolling back';
  exception when sqlstate 'GC001' then
    null;   -- every write in this block is undone; result keeps its value
  end;
  return result || jsonb_build_object('dry_run', true);
end;
$$;

-- ============================================================
-- Only the server role may call these (the Edge Function uses it)
-- ============================================================
revoke all on function public.catalog_ingest(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.catalog_ingest_apply(jsonb) from public, anon, authenticated;
revoke all on function public.catalog_name_key(text) from public, anon, authenticated;
grant execute on function public.catalog_ingest(jsonb, boolean) to service_role;
grant execute on function public.catalog_ingest_apply(jsonb) to service_role;
grant execute on function public.catalog_name_key(text) to service_role;
