# Genshin sync helper (STA-5)

Keeps GachaCheck's Genshin numbers up to date without typing them in. Every 15 minutes it reads your
Genshin **Real-Time Notes** on HoYoLAB and sends GachaCheck:

- your **Original Resin**, and when it will be full (so the countdown and stamina pings stay right);
- whether today's **commissions** are done: all four finished *and* the bonus claimed from Katheryne.
  Then it ticks "Daily commissions" for today (once).

Nothing else is sent, and it never touches the game.

## Before you start

- **Opt-in, at your own risk.** HoYoverse's terms broadly forbid unofficial automation. Tools that read
  Real-Time Notes this way say "use at your own risk" (no bans are reported). This helper only reads what
  the HoYoLAB website already shows you, the same way the website asks for it.
- HoYoLAB can change how its requests are signed at any time. If it does, the helper stops with a clear
  message until it's updated.
- Needs Node 18 or newer (the same Node you use for GachaCheck). Nothing to install.

## Set up (once)

1. On **hoyolab.com**: open your Battle Chronicle, then its settings, and turn on **Real-Time Notes** for Genshin.
2. In **GachaCheck**: Games page → *Automatic updates* → **Make a helper key**, and copy it.
3. In **PowerShell**, in your GachaCheck folder:

   ```powershell
   node tools/genshin-sync/genshin-sync.mjs setup
   ```

   It asks for your GachaCheck address and publishable key (offered from `.env.local`), the helper key,
   your Genshin UID and your HoYoLAB cookies (`ltuid_v2`, `ltoken_v2`, and `ltmid_v2` if present). It
   explains where to find the cookies; you can paste them one by one or as a whole cookie line. Secrets
   aren't shown as you paste. It finishes by reading your notes once, to check everything works.
4. Start the background updates:

   ```powershell
   node tools/genshin-sync/genshin-sync.mjs schedule
   ```

   This adds a Windows scheduled task, "GachaCheck Genshin sync": every 15 minutes while you're logged
   in, with no window. It also runs the first update straight away.

## Every command

| Command      | What it does |
|--------------|--------------|
| `setup`      | Asks for the keys above and saves them on this PC. Run it again to change any of them. |
| `test`       | Reads your notes from HoYoLAB and shows them. Sends nothing to GachaCheck. |
| `run`        | One update now. |
| `schedule`   | Updates every 15 minutes in the background (Windows). |
| `unschedule` | Stops the background updates. |
| `status`     | Where things are saved, whether it's scheduled, and the last few updates. |

## Where things are kept

- Your answers: `%APPDATA%\GachaCheck\genshin-sync.json`, in your own Windows user folder. **Not** in the
  GachaCheck folder, so never in git. The HoYoLAB cookies go only to HoYoLAB; the helper key only to GachaCheck.
- A log of each update (no secrets in it): `%APPDATA%\GachaCheck\genshin-sync.log`, last 300 lines.
- In GachaCheck, the key is stored only as a fingerprint. The Games page shows when each key last
  updated and what it did, and warns if a key goes quiet for over an hour.

## When something's wrong

The helper says what to do, in the console and in the log:

- **Cookies expired**: log in on hoyolab.com again and rerun `setup` with the new cookies.
- **Real-Time Notes are turned off**: turn them on in HoYoLAB (step 1).
- **HoYoLAB wants a human check**: open hoyolab.com and view your notes once; it retries in 15 minutes.
- **Key cancelled**: make a new key on the Games page and rerun `setup`.

## Stopping for good

1. `node tools/genshin-sync/genshin-sync.mjs unschedule`
2. Cancel the key on the Games page.
3. Delete `%APPDATA%\GachaCheck\genshin-sync.json` (it holds your HoYoLAB cookies).
