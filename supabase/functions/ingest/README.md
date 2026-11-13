# Ingest: the collector's way into the event catalog

The collector (Python, in `collector/`) never talks to the database. It sends what it read from
official sources to this Edge Function, which checks the data and hands it to the database
function `public.catalog_ingest`. A run is all or nothing.

```
collector ──POST /functions/v1/ingest──> Edge Function ──rpc──> catalog_ingest(payload, dry)
          header: x-ingest-secret         checks secret,          one transaction
                                          size, every record
```

## Calling it

| | |
|---|---|
| Method | `POST`, JSON body, at most 1 MB |
| Auth | Header `x-ingest-secret: <INGEST_SECRET>`. Not a Supabase key. |
| Dry run | `?dry=1` runs the real steps, then rolls them back. The result is exact. |
| Limits | 50 articles per request, 200 observations per article, 1,000 in total |

Replies always include `request_id`. On a 500 the reply says only that nothing was saved; the
cause is in the function logs under that id.

| Status | Meaning |
|---|---|
| 200 | Saved (or, for a dry run, what would be saved). See `counts` and `items`. |
| 400 | The payload is wrong. `details` lists every problem. Nothing was saved. |
| 401 | Missing or wrong secret. |
| 413 | Body over 1 MB. |
| 500 | Server or database error. Nothing was saved. |

## Payload

```json
{
  "source": "wuwa_official_site",
  "game": "wuwa",
  "articles": [
    {
      "external_id": "5783",
      "title": "Patch Notes for Version 3.8: Lilies in a Dying Dream",
      "url": "https://wutheringwaves.kurogames.com/en/main/news/detail/5783",
      "article_kind": "patch_notes",
      "published_at": "2026-11-12T10:00:00+08:00",
      "content_hash": "48CF4518551DBF235796A664DFAD4816",
      "complete": true,
      "observations": [
        {
          "observed_key": "lahai-roi blocks turnabout",
          "kind": "event",
          "version": "3.8",
          "name": "Lahai-Roi Blocks: Turnabout",
          "starts_local": "2026-11-19T04:00",
          "ends_local": "2026-12-03T03:59",
          "time_basis": "server_local",
          "start_rule": "exact",
          "raw_text": "✦Duration: 2026-11-19 04:00 - 2026-12-03 03:59 (server time)",
          "trusted": true
        }
      ]
    }
  ]
}
```

Field rules are in `supabase/functions/_shared/ingest.ts` (`checkPayload`). The important ones:

- **Times** are the clock times the publisher printed, written `YYYY-MM-DDTHH:MM`, never converted.
  `time_basis` says whose clock: `server_local` (each server's own) or `fixed_offset` with
  `utc_offset_minutes` (480 for "UTC+8").
- **`start_rule`**: `exact` needs `starts_local`; `after_update` means "after the version update";
  `unknown` when the source gives no start.
- **`observed_key`**: the collector's stable key for this item inside the article. Keep it the same
  when the publisher edits a date, so the edit updates the existing event. Merge repeats of one event
  inside an article before sending; the same key twice in one article is rejected.
- **Endgame cycles** (`kind: endgame_cycle`) need `task_preset_key` and an `occurrence_key`
  (a cycle number or label, else the cycle's start date).

## When the collector may set `complete: true`

`complete: true` tells the database "these are all the events in this article". Any observation the
article listed before but not now is marked `missing_since`.

The collector may set it **only when all of these hold** for that article in this run:

1. The article was fetched successfully (HTTP 200, the expected JSON or HTML shape).
2. The parser ran over the whole article without an error.
3. Every dated line the parser recognised became an observation in this request.

If any step failed or was cut short, send the article with `complete: false` (or leave it out).
A partial or failed parse must never mark earlier observations as missing.

## Trust policy: when an event is confirmed without review

A **new** event is saved as `confirmed` only when all three hold:

1. The collector set `trusted: true` (its parser matched the expected pattern exactly).
2. It has an end date.
3. A row in `public.catalog_trust_rules` allows that `source`, `article_kind` and `kind`.

Otherwise it is saved as `needs_review` and is not shown to anyone but admins until approved.
The collector's flag alone can never confirm anything. Trust rules change only through a migration.

Rules at launch:

| source | article_kind | kinds |
|---|---|---|
| `wuwa_official_site` | `patch_notes` | event, web_event, endgame_cycle |
| `nte_official_site` | `patch_notes` | event, web_event |

## What happens to each observation

1. Its event is found by (article, `observed_key`), then by identity
   (game, version, kind, server scope, normalised name, occurrence key), else it is new.
2. Same dates as the event: nothing changes.
3. Different dates: a rejected event is left alone (`ignored`); an event a reviewer edited is left
   alone and the observation is flagged (`conflict`); if another current source disagrees, the event
   is sent back to review (`conflict`); otherwise the event takes the new dates (`updated`).
4. An article that reports one event under two keys: the second is `skipped`.

## Tests

- Payload rules: `src/lib/ingest.test.ts` (Vitest, `npm test`).
- Database behaviour: `supabase/tests/catalog_ingest_scenarios.sql`. Run it in the Supabase SQL
  editor or with `psql`. It uses a fake game `zztest` and source `zztest_source`, removes its own rows,
  and ends with a results table where every row should show `pass = true`.
