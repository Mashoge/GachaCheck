# GachaCheck

A personal companion for gacha dailies. It tracks daily, weekly, monthly and endgame tasks, live stamina
and time to full, reset and event countdowns for Genshin Impact, Wuthering Waves and Neverness to
Everness, and pings Discord before something is wasted or missed. Phone and PC show the same data.

GachaCheck is unofficial and not affiliated with the game publishers.

## How it fits together

| Part | Where | Job |
|---|---|---|
| Web app (installable PWA) | `src/` | Today, game pages, Events, Games, Reminders. Vite, React, TypeScript, Tailwind. |
| Game presets | `src/data/presets.ts` | Servers, resets, stamina meters and tasks per game. Existing games sync when a preset version goes up. |
| Database | `supabase/migrations/` | Supabase Postgres with row-level security: your games, tasks, ticks and settings are yours only; the official event catalog is shared and read-only. |
| Reminders | `supabase/functions/remind/` | Called every 15 minutes; posts due reminders to Discord and adds new Genshin events from the official feed once a day. |
| Event catalog | `supabase/functions/ingest/` | Receives official WuWa and NTE event dates from the collector. See its [README](supabase/functions/ingest/README.md). |
| Collector | `collector/` | Python. Reads official patch notes and sends what it finds to `ingest`. See its [README](collector/README.md). |

## Run the app locally

Needs Node.js 24 (the version CI uses) and a Supabase project.

```powershell
npm install
```

Create `.env.local` in the project root. It is ignored by git (`*.local`), so keys never get committed:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

Only the publishable key belongs here. Secret keys never go into the web app.

| Command | Does |
|---|---|
| `npm run dev` | Start the app at http://localhost:5173 |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest): reset and stamina math, reminders, events, task order |
| `npm run build` | Type-check and build into `dist/` |
| `npm run check:pwa` | Check the manifest and launcher icons |
| `npm run preview` | Serve the production build |

## Database

Migrations in `supabase/migrations/` are applied in name order with the Supabase CLI
(`npx supabase db push` against the linked project).

`src/lib/database.types.ts` describes the tables for TypeScript. Some entries were added by hand;
keep it in step with the migrations.

The SQL tests in `supabase/tests/` run in the Supabase SQL Editor. Each one uses temporary rows
and rolls everything back.

## Edge Functions and secrets

Secrets are set with `npx supabase secrets set NAME=value` and are never committed.

| Function | Secrets | Called by |
|---|---|---|
| `remind` | `CRON_SECRET`, `DISCORD_WEBHOOK_URL`; optional `APP_URL` adds an "Open GachaCheck" link | A schedule every 15 minutes, with the header `x-cron-secret`. `?dry=1` sends nothing and returns what it would send. |
| `ingest` | `INGEST_SECRET` | The collector, with the header `x-ingest-secret`. `?dry=1` runs everything, then rolls it back. |

## Automation

- **CI** (`.github/workflows/ci.yml`): on every push and pull request, runs the PWA check, lint,
  tests and build.
- **Collect events** (`.github/workflows/collect.yml`): twice a day (11:17 AM and 11:17 PM in Manila)
  runs the collector for WuWa and NTE. Needs the repository secret `INGEST_SECRET`. Can also be run
  by hand from the Actions tab, with a dry-run option.
- **Deploy**: Vercel builds and publishes every push to `main`. `vercel.json` sends every route to
  the app and sets caching headers for the manifest and icons.

## Rules that keep the data right

- Nothing is cleared at reset. A tick counts only if it was made after the latest reset of that task's
  clock, so history is kept.
- Reset times use each game's server clock, chosen when the game is added.
- Stamina is entered as the game shows it and counted up from there. Values above the cap (after a
  refill) are allowed and labelled as such; it doesn't regenerate until you record a value below the cap.
- Official events come from the shared catalog; your done marks, notes and hidden events are yours
  only. Hidden events can be restored from the bottom of the Events page.
