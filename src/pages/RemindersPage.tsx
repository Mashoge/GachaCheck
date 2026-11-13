import { useCallback, useEffect, useState } from 'react'
import { messageOf } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { formatWhen } from '../lib/time'
import { useNow } from '../lib/useNow'
import { Card, Input, Loading, Notice, PageTitle, Select, Switch } from '../components/ui'

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
        <PageTitle>Reminders</PageTitle>
        <p className="text-sm text-muted">Sent to your Discord channel. GachaCheck checks every 15 minutes.</p>
      </div>

      {error && <Notice tone="error" size="md">{error}</Notice>}
      {!loaded && <Loading />}
      {loaded && !settings && !error && <Notice size="md">No settings found for this account.</Notice>}

      {settings && (
        <>
          <Card as="section" padding="md" tone={stale ? 'urgent' : 'default'}>
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
          </Card>

          <Card as="section" className="flex flex-col gap-3">
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
          </Card>

          <Card as="section" className="flex flex-col gap-3">
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
          </Card>

          <Card as="section" className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-semibold">Event reminder</h2>
              <p className="text-sm text-muted">One message per event before it ends, with your progress note. Events marked as done are skipped.</p>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="event-days" className="text-sm text-muted">Remind me</label>
              <Select
                id="event-days"
                value={settings.event_reminder_days}
                onChange={(e) => void saveSettings({ event_reminder_days: Number(e.target.value) })}
              >
                {(EVENT_DAY_CHOICES.includes(settings.event_reminder_days) ? EVENT_DAY_CHOICES : [...EVENT_DAY_CHOICES, settings.event_reminder_days]).map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? 'Never' : n === 1 ? '1 day before' : `${n} days before`}
                  </option>
                ))}
              </Select>
            </div>
          </Card>

          <Card as="section" className="flex flex-col">
            <h2 className="text-sm font-semibold">Per game</h2>
            <p className="pb-2 text-sm text-muted">Stamina pings are sent once per fill-up, when a meter reaches 90%.</p>
            {games.length === 0 && <Notice>No games added yet.</Notice>}
            {games.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line py-3">
                <span className="text-sm font-medium">{g.name}</span>
                {/* Three even columns on a phone, one row on wider screens */}
                <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:items-center sm:gap-5">
                  <span className="flex flex-col items-start gap-1.5 text-sm text-muted sm:flex-row sm:items-center sm:gap-2">
                    Nudge
                    <Switch label={`${g.name} in the evening nudge`} on={g.notify_nudge} onChange={(on) => void saveGame(g.id, { notify_nudge: on })} />
                  </span>
                  <span className="flex flex-col items-start gap-1.5 text-sm text-muted sm:flex-row sm:items-center sm:gap-2">
                    Stamina
                    <Switch label={`${g.name} stamina pings`} on={g.notify_stamina} onChange={(on) => void saveGame(g.id, { notify_stamina: on })} />
                  </span>
                  <span className="flex flex-col items-start gap-1.5 text-sm text-muted sm:flex-row sm:items-center sm:gap-2">
                    Events
                    <Switch label={`${g.name} event reminders`} on={g.notify_events} onChange={(on) => void saveGame(g.id, { notify_events: on })} />
                  </span>
                </div>
              </div>
            ))}
          </Card>

          <p className="text-xs text-muted">Times use your timezone: {settings.timezone}.</p>
        </>
      )}
    </div>
  )
}

function TimeField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-muted">{label}</label>
      <Input
        id={id}
        type="time"
        value={value}
        onChange={(e) => {
          if (/^\d{2}:\d{2}$/.test(e.target.value)) onChange(e.target.value)
        }}
      />
    </div>
  )
}
