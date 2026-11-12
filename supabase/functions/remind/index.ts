// Discord reminders. A schedule calls this every 15 minutes.
//
//   POST /functions/v1/remind            sends what is due and records it in notify_log
//   POST /functions/v1/remind?dry=1      sends nothing; returns what it would send
//   POST /functions/v1/remind?dry=1&at=2026-11-12T13:05:00Z   dry run as if it were that time
//
// Every call needs the header  x-cron-secret: <CRON_SECRET>.
// Secrets (set with `supabase secrets set`, never committed): CRON_SECRET, DISCORD_WEBHOOK_URL.
// Optional setting: APP_URL (the address of the app) adds an "Open GachaCheck" link to each message.

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  buildReminders, inQuietHours, lastNudgeTime, toMessages, whatsLeft,
  type Completions, type Reminder, type ReminderEvent, type ReminderGame, type ReminderSettings,
} from '../_shared/reminders.ts'
import { meterStates } from '../_shared/stamina.ts'

const GAME_COLUMNS =
  'id, user_id, name, timezone, daily_reset_time, weekly_reset_day, notify_nudge, notify_stamina, notify_events, skipped_until, ' +
  'tasks(id, title, frequency, category, hidden, optional, archived, weekly_target, monthly_day, cycle_anchor, cycle_days, cycle_ends_at), ' +
  'stamina_meters(id, name, cap, minutes_per_point, fills_when_full_of, current_value, value_recorded_at)'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS')
  const key = (keys ? JSON.parse(keys)['default'] : undefined) ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Supabase URL or server key is missing from the function environment')
  return createClient(url, key, { auth: { persistSession: false } })
}

async function sendToDiscord(webhook: string, content: string) {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  })
  if (!res.ok) throw new Error(`Discord answered ${res.status}`)
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret) return json({ error: 'CRON_SECRET is not set' }, 500)
  if (req.headers.get('x-cron-secret') !== secret) return json({ error: 'Not allowed' }, 401)

  const params = new URL(req.url).searchParams
  const dry = params.get('dry') === '1'
  const at = dry ? params.get('at') : null // a pretend time is only allowed in a dry run
  const now = at ? new Date(at) : new Date()
  if (Number.isNaN(now.getTime())) return json({ error: 'Bad "at" time' }, 400)

  const webhook = Deno.env.get('DISCORD_WEBHOOK_URL')
  const appUrl = Deno.env.get('APP_URL')?.trim()
  if (!dry && !webhook) return json({ error: 'DISCORD_WEBHOOK_URL is not set' }, 500)

  try {
    const db = adminClient()
    const since = new Date(now.getTime() - 62 * 86_400_000).toISOString()
    const [settingsRes, gamesRes, completionsRes, eventsRes] = await Promise.all([
      db.from('user_settings').select('user_id, timezone, nudge_enabled, nudge_time, quiet_start, quiet_end, event_reminder_days'),
      db.from('games').select(GAME_COLUMNS).order('sort_order'),
      db.from('completions').select('task_id, completed_at').gte('completed_at', since),
      db.from('events').select('id, user_id, game_id, name, starts_at, ends_at, note, remind, completed_at').gt('ends_at', now.toISOString()).is('completed_at', null),
    ])
    if (settingsRes.error) throw settingsRes.error
    if (gamesRes.error) throw gamesRes.error
    if (completionsRes.error) throw completionsRes.error
    if (eventsRes.error) throw eventsRes.error
    const allEvents = eventsRes.data as (ReminderEvent & { user_id: string })[]

    const allGames = gamesRes.data as unknown as (ReminderGame & { user_id: string })[]
    const completions: Completions = new Map()
    for (const c of completionsRes.data as { task_id: string; completed_at: string }[]) {
      const list = completions.get(c.task_id) ?? []
      list.push(c.completed_at)
      completions.set(c.task_id, list)
    }

    const report = []
    for (const settings of settingsRes.data as ReminderSettings[]) {
      // One user's problem must not stop the others.
      try {
        const games = allGames.filter((g) => g.user_id === settings.user_id)
        const events = allEvents.filter((e) => e.user_id === settings.user_id)
        const due = buildReminders(settings, games, completions, now, events)

        if (dry) {
          const sent = new Set<string>()
          if (due.length > 0) {
            const { data, error } = await db.from('notify_log').select('dedupe_key').in('dedupe_key', due.map((r) => r.key))
            if (error) throw error
            for (const row of data) sent.add(row.dedupe_key)
          }
          report.push({
            wouldSend: due.filter((r) => !sent.has(r.key)).map((r) => ({ kind: r.kind, text: r.text })),
            alreadySent: due.filter((r) => sent.has(r.key)).map((r) => r.kind),
            status: {
              lastNudgeTime: lastNudgeTime(settings, now).toISOString(),
              nudgeEnabled: settings.nudge_enabled,
              quietHoursNow: inQuietHours(settings, now),
              meters: games.flatMap((g) =>
                meterStates(g.stamina_meters, now).filter((m) => !m.isOverflow).map((m) => `${g.name}: ${m.name} ${m.value}/${m.cap}`),
              ),
              left: whatsLeft(games, completions, now, events).map((g) => ({
                game: g.game,
                dailies: g.dailies,
                endgame: g.endgame.map((e) => `${e.title} (ends ${e.endsAt.toISOString()})`),
                events: g.events.map((e) => `${e.name} (ends ${e.endsAt.toISOString()})`),
              })),
              openEvents: events.length,
            },
          })
          continue
        }

        // Claim each reminder in notify_log first; a key that is already there is skipped,
        // so two overlapping runs can never send the same reminder twice.
        const fresh: Reminder[] = []
        for (const r of due) {
          const { data, error } = await db
            .from('notify_log')
            .upsert({ user_id: settings.user_id, kind: r.kind, dedupe_key: r.key }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
            .select('id')
          if (error) throw error
          if (data.length > 0) fresh.push(r)
        }

        let sentCount = 0
        for (const message of toMessages(fresh)) {
          try {
            // <…> keeps Discord from adding a large link preview
            await sendToDiscord(webhook!, appUrl ? `${message.content}\n\n[Open GachaCheck](<${appUrl}>)` : message.content)
            sentCount += message.keys.length
          } catch (err) {
            // Not delivered: release the claim so the next run tries again.
            await db.from('notify_log').delete().in('dedupe_key', message.keys)
            throw err
          }
        }
        report.push({ due: due.length, sent: sentCount })

        // Shown on the Reminders page as "Last checked"
        const { error: stampError } = await db.from('user_settings').update({ last_reminder_run_at: now.toISOString() }).eq('user_id', settings.user_id)
        if (stampError) console.error('Could not save the last-checked time:', stampError.message)
      } catch (err) {
        console.error('Reminder run failed for one user:', err)
        report.push({ error: err instanceof Error ? err.message : String(err) })
      }
    }

    console.log(`remind ${dry ? '(dry run) ' : ''}at ${now.toISOString()}: ${JSON.stringify(dry ? report.length : report)}`)
    return json({ dryRun: dry, now: now.toISOString(), users: report })
  } catch (err) {
    console.error('Reminder run failed:', err)
    const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err)
    return json({ error: message }, 500)
  }
})
