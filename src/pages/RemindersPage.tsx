import { useCallback, useEffect, type ReactNode } from 'react'
import { Link } from 'react-router'
import { messageOf } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { formatDuration, formatWhen } from '../lib/time'
import { useNow } from '../lib/useNow'
import { useShared } from '../lib/useShared'
import { reminderData, type GameSwitches, type Settings } from '../lib/reminderSettings'
import { GameIcon } from '../components/GameIcon'
import { buttonClass, ChevronIcon, Input, Loading, Notice, PageTitle, Select, SheetRow, Switch } from '../components/ui'
import { useGameIcons } from '../lib/useGameIcons'

// Work days, shown Monday first. Stored as 0 = Sunday ... 6 = Saturday, like a game's weekly reset day.
const WORK_DAYS = [
  { day: 1, short: 'Mon', long: 'Monday' }, { day: 2, short: 'Tue', long: 'Tuesday' }, { day: 3, short: 'Wed', long: 'Wednesday' },
  { day: 4, short: 'Thu', long: 'Thursday' }, { day: 5, short: 'Fri', long: 'Friday' }, { day: 6, short: 'Sat', long: 'Saturday' },
  { day: 0, short: 'Sun', long: 'Sunday' },
]
const EVENT_DAY_CHOICES = [0, 1, 2, 3, 5, 7]
const STALE_AFTER_MS = 45 * 60_000 // the schedule runs every 15 minutes
const hhmm = (time: string | null) => (time ?? '').slice(0, 5)

const NO_GAMES: GameSwitches[] = []

export default function RemindersPage() {
  const now = useNow()
  // THM-10: the shared copy (reminderSettings.ts), so this page opens at once after the first visit
  const { data, error, setError, refresh: reload } = useShared(reminderData)
  const settings = data?.settings ?? null
  const games = data?.games ?? NO_GAMES
  const loaded = data !== null || error !== null
  const icons = useGameIcons(games)
  const refresh = useCallback(() => reload().catch(() => {}), [reload])

  // The status line also refreshes every five minutes while the page is open
  useEffect(() => {
    const id = setInterval(() => void refresh(), 5 * 60_000)
    return () => clearInterval(id)
  }, [refresh])

  // Show the change straight away, save it, and reload if saving fails.
  const saveSettings = async (patch: Partial<Settings>) => {
    if (!settings) return
    reminderData.change((d) => (d.settings ? { ...d, settings: { ...d.settings, ...patch } } : d))
    const { error: err } = await supabase.from('user_settings').update(patch).eq('user_id', settings.user_id)
    if (err) {
      setError(messageOf(err))
      await refresh()
    }
  }

  const saveGame = async (id: string, patch: Partial<GameSwitches>) => {
    reminderData.change((d) => ({ ...d, games: d.games.map((g) => (g.id === id ? { ...g, ...patch } : g)) }))
    const { error: err } = await supabase.from('games').update(patch).eq('id', id)
    if (err) {
      setError(messageOf(err))
      await refresh()
    }
  }

  const lastRun = settings?.last_reminder_run_at ? new Date(settings.last_reminder_run_at) : null
  const stale = lastRun ? now.getTime() - lastRun.getTime() > STALE_AFTER_MS : false
  const quietOn = !!settings?.quiet_start && !!settings?.quiet_end
  const workOn = !!settings?.work_start && !!settings?.work_end
  const toggleWorkDay = (day: number) => {
    if (!settings) return
    const days = settings.work_days.includes(day) ? settings.work_days.filter((d) => d !== day) : [...settings.work_days, day]
    void saveSettings({ work_days: days.sort((a, b) => a - b) })
  }

  // THM-9 (step 3): the Today page's voice here too. The schedule is one settings sheet (labels on the
  // left, hairline rows), the status sits beside it (first on a phone), then the switches per game.
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <PageTitle>Reminders</PageTitle>
        <p className="text-sm text-muted">Sent to your Discord channel. GachaCheck checks every 15 minutes.</p>
      </div>

      {error && <Notice tone="error" size="md">{error}</Notice>}
      {!loaded && <Loading />}
      {loaded && !settings && !error && <Notice size="md">No settings found for this account.</Notice>}

      {settings && (
        <div className="grid items-start gap-x-6 gap-y-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4 lg:order-last">
            <section aria-labelledby="status-h" className={`rounded-2xl border bg-surface p-4 ${stale ? 'border-urgent' : 'border-line'}`}>
              <div className="flex items-center justify-between gap-3">
                <h2 id="status-h" className="gc-label">Status</h2>
                <span className="gc-tag" data-tone={stale ? 'urgent' : !lastRun ? 'rest' : undefined}>
                  {stale ? 'Not checking' : lastRun ? 'Running' : 'Waiting'}
                </span>
              </div>
              {!lastRun ? (
                <p className="mt-3 text-sm text-muted">Not checked yet. The first check happens within 15 minutes of turning the schedule on.</p>
              ) : (
                <>
                  <p className="mt-3 text-xs text-muted">Last checked</p>
                  <p className={`font-display text-3xl font-bold leading-tight ${stale ? 'text-urgent' : ''}`}>
                    {formatDuration(Math.max(60_000, now.getTime() - lastRun.getTime()))} ago
                  </p>
                  <p className="text-xs text-muted">{formatWhen(lastRun, now)}</p>
                  {stale && (
                    <p className="mt-3 text-sm text-muted">
                      Reminders may have stopped. Check that the Supabase project isn&apos;t paused and that the schedule is still active.
                    </p>
                  )}
                </>
              )}
              <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-3">
                <span className="gc-label">Your timezone</span>
                <span className="text-sm">{settings.timezone}</span>
              </div>
              <p className="mt-1 text-xs text-muted">Every time on this page uses it.</p>
            </section>

            <section aria-labelledby="pings-h" className="rounded-2xl border border-line bg-surface p-4">
              <h2 id="pings-h" className="gc-label">Stamina pings</h2>
              <p className="mt-2 text-sm text-muted">
                Sent once per fill-up, when a meter reaches 90% or the number you set for it in Games.
              </p>
              <Link to="/games" className={`${buttonClass({ variant: 'link', size: 'sm' })} mt-1 -ml-1`}>
                Set ping levels in Games <ChevronIcon size={14} />
              </Link>
            </section>
          </div>

          <div className="flex min-w-0 flex-col gap-8">
            <section aria-labelledby="schedule-h" className="flex flex-col gap-3">
              <h2 id="schedule-h" className="text-base font-semibold">Schedule</h2>
              <div className="overflow-hidden rounded-2xl border border-line bg-surface">
                <SheetRow label="Evening nudge">
                  <Setting text="One message listing unticked dailies, plus endgame and events that end within 24 hours.">
                    <Switch label="Evening nudge" on={settings.nudge_enabled} onChange={(on) => void saveSettings({ nudge_enabled: on })} />
                  </Setting>
                  {settings.nudge_enabled && (
                    <div className="mt-3">
                      <TimeField id="nudge-time" label="Send at" value={hhmm(settings.nudge_time)} onChange={(v) => void saveSettings({ nudge_time: v })} />
                    </div>
                  )}
                </SheetRow>

                <SheetRow label="Quiet hours">
                  <Setting text="Stamina pings and event reminders wait until quiet hours end. If a meter would fill during them, you get one ping 30 minutes before they start instead. The evening nudge is not affected.">
                    <Switch
                      label="Quiet hours"
                      on={quietOn}
                      onChange={(on) => void saveSettings(on ? { quiet_start: '23:00', quiet_end: '07:00' } : { quiet_start: null, quiet_end: null })}
                    />
                  </Setting>
                  {quietOn && (
                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
                      <TimeField id="quiet-start" label="From" value={hhmm(settings.quiet_start)} onChange={(v) => void saveSettings({ quiet_start: v })} />
                      <TimeField id="quiet-end" label="Until" value={hhmm(settings.quiet_end)} onChange={(v) => void saveSettings({ quiet_end: v })} />
                    </div>
                  )}
                </SheetRow>

                {/* SUP-4: work hours behave like quiet hours, on the days picked here */}
                <SheetRow label="Work hours">
                  <Setting text="Like quiet hours, on the days you pick: pings wait until work ends, and a meter that would fill during work is pinged 30 minutes before it starts.">
                    <Switch
                      label="Work hours"
                      on={workOn}
                      onChange={(on) => void saveSettings(on ? { work_start: '09:00', work_end: '18:00' } : { work_start: null, work_end: null })}
                    />
                  </Setting>
                  {workOn && (
                    <div className="mt-3 flex flex-col gap-3">
                      <div className="flex flex-wrap gap-x-6 gap-y-3">
                        <TimeField id="work-start" label="From" value={hhmm(settings.work_start)} onChange={(v) => void saveSettings({ work_start: v })} />
                        <TimeField id="work-end" label="Until" value={hhmm(settings.work_end)} onChange={(v) => void saveSettings({ work_end: v })} />
                      </div>
                      <div role="group" aria-label="Work days" className="flex flex-wrap gap-2 pl-1">
                        {WORK_DAYS.map((d) => (
                          <button
                            key={d.day}
                            type="button"
                            aria-pressed={settings.work_days.includes(d.day)}
                            aria-label={d.long}
                            onClick={() => toggleWorkDay(d.day)}
                            className="gc-chip"
                          >
                            <span>{d.short}</span>
                          </button>
                        ))}
                      </div>
                      {settings.work_days.length === 0 && <Notice>No days picked, so work hours never apply.</Notice>}
                      <p className="text-xs text-muted">A shift that runs past midnight counts as the day it starts on.</p>
                    </div>
                  )}
                </SheetRow>

                <SheetRow label="Events">
                  <Setting stack text="One message per event before it ends, with your progress note. Events marked as done are skipped.">
                    <label htmlFor="event-days" className="sr-only">Event reminder</label>
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
                  </Setting>
                </SheetRow>
              </div>
            </section>

            <section aria-labelledby="per-game-h" className="flex flex-col gap-3">
              <h2 id="per-game-h" className="text-base font-semibold">Per game</h2>
              {games.length === 0 ? (
                <Notice>No games added yet.</Notice>
              ) : (
                <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
                  {games.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line px-4 py-3 first:border-t-0 sm:px-5">
                      <span className="flex min-w-0 items-center gap-3">
                        <GameIcon presetId={g.preset_id} url={icons[g.id]} size={28} />
                        <span className="text-sm font-semibold">{g.name}</span>
                      </span>
                      {/* Three even columns on a phone, one row on wider screens */}
                      <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:items-center sm:gap-6">
                        <GameSwitch label="Nudge" name={`${g.name} in the evening nudge`} on={g.notify_nudge} onChange={(on) => void saveGame(g.id, { notify_nudge: on })} />
                        <GameSwitch label="Stamina" name={`${g.name} stamina pings`} on={g.notify_stamina} onChange={(on) => void saveGame(g.id, { notify_stamina: on })} />
                        <GameSwitch label="Events" name={`${g.name} event reminders`} on={g.notify_events} onChange={(on) => void saveGame(g.id, { notify_events: on })} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  )
}

/** A setting's explanation, with its control on the right (with `stack`, below it on a phone). */
function Setting({ text, stack = false, children }: { text: string; stack?: boolean; children: ReactNode }) {
  return (
    <div className={`flex items-start justify-between gap-x-4 gap-y-3 ${stack ? 'max-sm:flex-col' : ''}`}>
      <p className="text-sm text-muted">{text}</p>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  )
}

function GameSwitch({ label, name, on, onChange }: { label: string; name: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <span className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-2.5">
      <span aria-hidden="true" className="gc-label">{label}</span>
      <Switch label={name} on={on} onChange={onChange} />
    </span>
  )
}

function TimeField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="gc-label">{label}</label>
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
