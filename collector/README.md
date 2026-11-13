# GachaCheck collector

A small Python program that reads official game announcements and sends the event dates it finds
to GachaCheck's `ingest` function. It only fetches and parses. It never converts time zones, never
talks to the database, and holds no database key.

```
official site ──> adapter (fetch + parse) ──> payload ──> POST /functions/v1/ingest
                  gachacheck_collector/wuwa.py            (checks, trust rules, saving happen there)
```

The contract it sends to is in `supabase/functions/ingest/README.md`.

## What it reads today

| Game | Source | Read | Not read |
|---|---|---|---|
| Wuthering Waves | Official site article files | Patch Notes: events, web events, the Endstate Matrix cycle end | Banners; the mid-version "Upcoming Events" notice (it is an image) |

Events the collector cannot read still go in through "Import list" in the app.

## Layout

| File | Job |
|---|---|
| `gachacheck_collector/models.py` | The records that are sent (same field names as the ingest contract) |
| `gachacheck_collector/wuwa.py` | Wuthering Waves adapter: find the Patch Notes, parse them |
| `gachacheck_collector/ingest.py` | Send a payload to the ingest function |
| `gachacheck_collector/__main__.py` | The command line |
| `tests/` | Tests that run on saved copies of the real official files, with no network |

## Set up (Windows PowerShell, once)

Needs Python 3.11 or newer (`python --version`).

```powershell
cd C:\dev\gachacheck\collector
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
```

## Run

```powershell
cd C:\dev\gachacheck\collector
.\.venv\Scripts\python -m pytest                              # the tests (no network)
.\.venv\Scripts\python -m gachacheck_collector wuwa --print   # fetch + parse, print the payload, send nothing
```

Sending needs two environment variables. Set them for the current window only; never write the
secret into a file:

```powershell
$env:INGEST_URL = "https://<project>.supabase.co/functions/v1/ingest"
$env:INGEST_SECRET = Get-Clipboard        # after copying it from the password manager
.\.venv\Scripts\python -m gachacheck_collector wuwa --dry-run   # nothing is saved
.\.venv\Scripts\python -m gachacheck_collector wuwa             # for real
Remove-Item Env:INGEST_SECRET
```

Exit codes: `0` fine, `1` the source or the ingest function failed, `2` settings missing,
`3` sent, but some lines could not be read (those articles were sent as not complete).

## Rules the adapters follow

- **Times are copied as printed.** `(server time)` becomes `server_local`; `(UTC+8)` becomes
  `fixed_offset` with 480 minutes. Conversion happens in the database, per user.
- **An article is marked `complete` only when** it was fetched, the whole body was parsed, and every
  dated line became an observation. One unreadable date makes the article not complete, so nothing
  already known is marked missing.
- **Nothing is guessed.** A line that does not match the expected pattern is reported as a problem
  and left out.
- **`trusted` means the parser matched the expected pattern.** Whether an event is confirmed
  without review is decided by the database's trust rules, not by this flag alone.
- **Discovery uses article ids, titles and publish times**, never the position in the index.
- **Polite fetching:** one index request and one request per current Patch Notes article per run,
  with a User-Agent that says what this is.

## Adding a game

Write `gachacheck_collector/<game>.py` with `SOURCE`, `GAME` and `collect() -> list[Article]`,
add it to `ADAPTERS` in `__main__.py`, save real pages under `tests/fixtures/<game>/`, and test the
parser on them. A trust rule for the new source is added by a database migration.
