import { useCallback, useEffect, useState } from 'react'
import { messageOf } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { formatWhen } from '../lib/time'
import { useNow } from '../lib/useNow'

type Settings = {
  user_id: string
  timezone: string
  nudge_enabled: boolean
  nudge_time: string
  quiet_start: string | null
  quiet_end: string | null
  event_reminder_days: number
  last_reminder_run_at: string | null
}

type GameSwitches = { id: string; name: string; notify_nudge: boolean; notify_stamina: boolean; notify_events: boolean }

const SETTINGS_COLUMNS = 'user_id, timezone, nudge_enabled, nudge_time, quiet_start, quiet_end, event_reminder_days, last_reminder_run_at'
const EVENT_DAY_CHOICES = [0, 1, 2, 3, 5, 7]
const STALE_AFTER_MS = 45 * 60_000 // the schedule runs every 15 minutes
const hhmm = (time: string | null) => (time ?? '').slice(0, 5)

async function load() {
  const [settingsRes, gamesRes] = await Promise.all([
    supabase.from('user_settings').select(SETTINGS_COLUMNS).maybeSingle(),
    supabase.from('games').select('id, name, notify_nudge, notify_stamina, notify_events').order('created_at'),
  ])
  if (settingsRes.error) throw settingsRes.error
  if (gamesRes.error) throw gamesRes.error
  return { settings: settingsRes.data as Settings | null, games: gamesRes.data as GameSwitches[] }
}

export default function RemindersPage() {
  const now = useNow()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [games, setGames] = useState<GameSwitches[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await load()
      setSettings(data.settings)
      setGames(data.games)
      setError(null)
    } catch (err) {
      setError(messageOf(err))
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Pick up a newer "last checked" time while the page stays open
  useEffect(() => {
    const id = setInterval(() => void refresh(), 5 * 60_000)
    return () => clearInterval(id)
  }, [refresh])

  // Show the change straight away, save it, and reload if saving fails.
  const saveSettings = async (patch: Partial<Settings>) => {
    if (!settings) return
    setSettings({ ...settings, ...patch })
    const { error: err } = await supabase.from('user_settings').update(patch).eq('user_id', settings.user_id)
    if (err) {
      setError(messageOf(err))
      await refresh()
    }
  }

  const saveGame = async (id: string, patch: Partial<GameSwitches>) => {
    setGames((list) => list.map((g) => (g.id === id ? { ...g, ...patch } : g)))
    const { error: err } = await supabase.from('games').update(patch).eq('id', id)
    if (err) {
      setError(messageOf(err))
      await refresh()
    }
  }

  const lastRun = settings?.last_reminder_run_at ? new Date(settings.last_reminder_run_at) : null
  const stale = lastRun ? now.getTime() - lastRun.getTime() > STALE_AFTER_MS : false
  const quietOn = !!settings?.quiet_start && !!settings?.quiet_end

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-bold">Reminders</h1>
        <p className="text-sm text-muted">Sent to your Discord channel. GachaCheck checks every 15 minutes.</p>
      </div>

      {error && <p className="text-urgent">{error}</p>}
      {!loaded && <p className="text-muted">Loading…</p>}
      {loaded && !settings && !error && <p className="text-muted">No settings found for this account.</p>}

      {settings && (
        <>
          <section className={`rounded-2xl border bg-surface p-4 ${stale ? 'border-urgent' : 'border-line'}`}>
            {!lastRun ? (
              <p className="text-sm text-muted">Not checked yet. The first check happens within 15 minutes of turning the schedule on.</p>
            ) : stale ? (
              <>
                <p className="text-sm font-semibold text-urgent">No check since {formatWhen(lastRun, now)}</p>
                <p className="mt-1 text-sm text-muted">
                  Reminders may have stopped. Check that the Supabase project isn't paused and that the schedule is still active.
                </p>
              </>
            ) : (
              <p className="text-sm">
                <span className="font-semibold">Reminders are running.</span>{' '}
                <span className="text-muted">Last checked {formatWhen(lastRun, now)}.</span>
              </p>
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-sm font-semibold">Evening nudge</h2>
                <p className="text-sm text-muted">One message listing unticked dailies, plus endgame and events that end within 24 hours.</p>
              </div>
              <Switch label="Evening nudge" on={settings.nudge_enabled} onChange={(on) => void saveSettings({ nudge_enabled: on })} />
            </div>
            {settings.nudge_enabled && (
              <TimeField
                id="nudge-time"
                label="Send at"
                value={hhmm(settings.nudge_time)}
                onChange={(v) => void saveSettings({ nudge_time: v })}
              />
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-sm font-semibold">Quiet hours</h2>
                <p className="text-sm text-muted">
                  Stamina pings and event reminders wait until quiet hours end. The evening nudge is not affected.
                </p>
              </div>
              <Switch
                label="Quiet hours"
                on={quietOn}
                onChange={(on) => void saveSettings(on ? { quiet_start: '23:00', quiet_end: '07:00' } : { quiet_start: null, quiet_end: null })}
              />
            </div>
            {quietOn && (
              <div className="flex flex-wrap gap-4">
                <TimeField id="quiet-start" label="From" value={hhmm(settings.quiet_start)} onChange={(v) => void saveSettings({ quiet_start: v })} />
                <TimeField id="quiet-end" label="Until" value={hhmm(settings.quiet_end)} onChange={(v) => void saveSettings({ quiet_end: v })} />
              </div>
            )}
          </section>

          <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-5">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-semibold">Event reminder</h2>
              <p className="text-sm text-muted">One message per event before it ends, with your progress note. Events marked as done are skipped.</p>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="event-days" className="text-sm text-muted">Remind me</label>
              <select
                id="event-days"
                value={settings.event_reminder_days}
                onChange={(e) => void saveSettings({ event_reminder_days: Number(e.target.value) })}
                className="min-h-10 rounded-lg border border-line bg-page px-3 text-sm text-ink"
              >
                {(EVENT_DAY_CHOICES.includes(settings.event_reminder_days) ? EVENT_DAY_CHOICES : [...EVENT_DAY_CHOICES, settings.event_reminder_days]).map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? 'Never' : n === 1 ? '1 day before' : `${n} days before`}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="flex flex-col rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-sm font-semibold">Per game</h2>
            <p className="pb-2 text-sm text-muted">Stamina pings are sent once per fill-up, when a meter reaches 90%.</p>
            {games.length === 0 && <p className="text-sm text-muted">No games added yet.</p>}
            {games.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line py-3">
                <span className="text-sm font-medium">{g.name}</span>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <span className="flex items-center gap-2 text-sm text-muted">
                    Nudge
                    <Switch label={`${g.name} in the evening nudge`} on={g.notify_nudge} onChange={(on) => void saveGame(g.id, { notify_nudge: on })} />
                  </span>
                  <span className="flex items-center gap-2 text-sm text-muted">
                    Stamina
                    <Switch label={`${g.name} stamina pings`} on={g.notify_stamina} onChange={(on) => void saveGame(g.id, { notify_stamina: on })} />
                  </span>
                  <span className="flex items-center gap-2 text-sm text-muted">
                    Events
                    <Switch label={`${g.name} event reminders`} on={g.notify_events} onChange={(on) => void saveGame(g.id, { notify_events: on })} />
                  </span>
                </div>
              </div>
            ))}
          </section>

          <p className="text-xs text-muted">Times use your timezone: {settings.timezone}.</p>
        </>
      )}
    </div>
  )
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${on ? 'border-accent bg-accent' : 'border-line bg-raised'}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-1/2 size-5 -translate-y-1/2 rounded-full transition-all ${on ? 'left-6 bg-on-accent' : 'left-0.5 bg-muted'}`}
      />
    </button>
  )
}

function TimeField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-muted">{label}</label>
      <input
        id={id}
        type="time"
        value={value}
        onChange={(e) => {
          if (/^\d{2}:\d{2}$/.test(e.target.value)) onChange(e.target.value)
        }}
        className="min-h-10 rounded-lg border border-line bg-page px-3 text-sm text-ink [color-scheme:dark]"
      />
    </div>
  )
}
