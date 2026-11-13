# GachaCheck collector

A small Python program that reads official game announcements and sends the event dates it finds
to GachaCheck's `ingest` function. It only fetches and parses. It never converts time zones, never
talks to the database, and holds no database key.

```
official site ──> adapter (fetch + parse) ──> payload ──> POST /functions/v1/ingest
                  gachacheck_collector/wuwa.py, nte.py    (checks, trust rules, saving happen there)
```

The contract it sends to is in `supabase/functions/ingest/README.md`.

## What it reads today

| Game | Source | Read | Not read |
|---|---|---|---|
| Wuthering Waves | Official site article files | Patch Notes: events, web events, the Endstate Matrix cycle end, when the version goes live | Banners; the mid-version "Upcoming Events" notice (it is an image) |
| NTE | Official English news pages (HTML) | Patch notes: limited-time events (including mystery boxes and the season pass), web events, when the version goes live | Banners, new story and stages, outfits and shop discounts |

Events the collector cannot read still go in through "Import list" in the app.

## Layout

| File | Job |
|---|---|
| `gachacheck_collector/models.py` | The records that are sent (same field names as the ingest contract) |
| `gachacheck_collector/wuwa.py` | Wuthering Waves adapter: find the Patch Notes, parse them |
| `gachacheck_collector/nte.py` | NTE adapter: page through the news index, find the patch notes, parse them |
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
.\.venv\Scripts\python -m gachacheck_collector nte --print
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
- **"After update" starts:** each patch notes article also sends `version_release`, the moment the
  update maintenance ends. The database stores it once per version and uses it as the start of every
  "after update" event. On the fixed UTC+8 clock the adapters also fill that start in directly.
- **Missing years (NTE):** event dates carry no year; the adapter takes the year that puts the date
  nearest the post date, so December notes with January dates land in the next year.
- **No change headers (NTE):** the pages send no ETag, so the content hash is an MD5 of the article
  text, not of the whole page, and a new footer or menu does not count as an edit.
- **Polite fetching:** WuWa needs one index request, NTE a few index pages (it stops once they are
  older than the lookback); then one request per current patch notes article per run,
  with a User-Agent that says what this is.

## Adding a game

Write `gachacheck_collector/<game>.py` with `SOURCE`, `GAME` and `collect() -> list[Article]`,
add it to `ADAPTERS` in `__main__.py`, save real pages under `tests/fixtures/<game>/`, and test the
parser on them. A trust rule for the new source is added by a database migration.
