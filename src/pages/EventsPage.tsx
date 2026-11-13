import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { findPreset, findServer } from '../data/presets'
import { messageOf } from '../lib/errors'
import { addEvent, addEvents, deleteEvent, fetchEvents, fetchShowWebEvents, hideEvent, setEventDone, setShowWebEvents, updateEvent, type EventInput, type GameEvent } from '../lib/events'
import { minuteBefore, serverParts, toInstant } from '../lib/eventTime'
import { formatDuration, formatWhen, taskPeriod } from '../lib/time'
import { clockOf, isVisible, useTodayData, type Game } from '../lib/today'
import { SHORT_NAMES } from '../lib/useGames'
import EventImport from './EventImport'
import { useNow } from '../lib/useNow'
import { PHONE, useMedia } from '../lib/useMedia'

const DAY = 86_400_000
const SOON_MS = 3 * DAY
const FILTER_KEY = 'gachacheck.events.filter'

// Game colour cue, as on Today
const GAME_BG: Record<string, string> = { genshin: 'bg-game-genshin', wuwa: 'bg-game-wuwa', nte: 'bg-game-nte' }
const gameBg = (game: Game | undefined) => GAME_BG[game?.preset_id ?? ''] ?? 'bg-accent'
const shortName = (game: Game | undefined) => (game ? (SHORT_NAMES[game.preset_id ?? ''] ?? game.name) : 'Unknown game')

const readFilter = () => {
  try {
    return localStorage.getItem(FILTER_KEY) ?? 'all'
  } catch {
    return 'all'
  }
}

export default function EventsPage() {
  const now = useNow()
  const { data, error: gamesError, loading } = useTodayData()
  const games = data?.games ?? []

  const [events, setEvents] = useState<GameEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState(readFilter)
  const [form, setForm] = useState<{ mode: 'add' } | { mode: 'import' } | { mode: 'edit'; event: GameEvent } | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [showWeb, setShowWeb] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const [list, web] = await Promise.all([fetchEvents(), fetchShowWebEvents()])
      setEvents(list)
      setShowWeb(web)
      setError(null)
    } catch (err) {
      setError(messageOf(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const chooseFilter = (value: string) => {
    setFilter(value)
    try {
      localStorage.setItem(FILTER_KEY, value)
    } catch {
      // The choice just isn't remembered on this device
    }
  }

  // Run a change, then reload the list. Returns false if it failed (the form stays open).
  const run = async (change: () => Promise<void>) => {
    try {
      await change()
      await refresh()
      return true
    } catch (err) {
      setError(messageOf(err))
      return false
    }
  }

  const gameOf = (e: GameEvent) => games.find((g) => g.id === e.game_id)
  const activeFilter = filter !== 'all' && games.some((g) => g.id === filter) ? filter : 'all'
  const shownGames = activeFilter === 'all' ? games : games.filter((g) => g.id === activeFilter)

  const live = (events ?? []).filter((e) => new Date(e.ends_at) > now && (activeFilter === 'all' || e.game_id === activeFilter))
  const done = live.filter((e) => e.completed_at)
  const open = live.filter((e) => !e.completed_at)
  const upcoming = open.filter((e) => e.starts_at && new Date(e.starts_at) > now).sort((a, b) => a.starts_at!.localeCompare(b.starts_at!))
  const running = open.filter((e) => !e.starts_at || new Date(e.starts_at) <= now)
  const soon = running.filter((e) => new Date(e.ends_at).getTime() - now.getTime() <= SOON_MS)
  const later = running.filter((e) => new Date(e.ends_at).getTime() - now.getTime() > SOON_MS)

  const card = (e: GameEvent) => (
    <EventCard
      key={e.id}
      event={e}
      game={gameOf(e)}
      now={now}
      onEdit={() => setForm({ mode: 'edit', event: e })}
      onDone={(isDone) => void run(() => setEventDone(e, isDone))}
    />
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Events</h1>
        {games.length > 0 && !form && (
          <div className="flex gap-2">
            <button type="button" onClick={() => setForm({ mode: 'import' })} className="min-h-10 rounded-lg border border-line px-4 text-sm font-semibold text-muted hover:text-ink">
              Import list
            </button>
            <button type="button" onClick={() => setForm({ mode: 'add' })} className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent">
              Add event
            </button>
          </div>
        )}
      </div>

      {(error || gamesError) && <p className="text-urgent">{error ?? gamesError}</p>}
      {(loading || events === null) && !error && !gamesError && <p className="text-muted">Loading…</p>}
      {data && games.length === 0 && (
        <p className="text-muted">
          Add a game first. <Link to="/games" className="text-accent underline">Manage games</Link>
        </p>
      )}

      {form?.mode === 'import' && games.length > 0 && (
        <EventImport
          games={games}
          existing={events ?? []}
          defaultGameId={activeFilter !== 'all' ? activeFilter : games[0].id}
          now={now}
          onCancel={() => setForm(null)}
          onImport={async (inputs) => {
            const ok = await run(() => addEvents(inputs))
            if (ok) setForm(null)
            return ok
          }}
        />
      )}

      {form && form.mode !== 'import' && games.length > 0 && (
        <EventForm
          key={form.mode === 'edit' ? form.event.id : 'new'}
          games={games}
          editing={form.mode === 'edit' ? form.event : null}
          defaultGameId={activeFilter !== 'all' ? activeFilter : games[0].id}
          now={now}
          onCancel={() => setForm(null)}
          onSave={async (input, keepOpen) => {
            const editing = form.mode === 'edit' ? form.event : null
            const ok = await run(() => (editing ? updateEvent(editing, input) : addEvent(input)))
            if (ok && !keepOpen) setForm(null)
            return ok
          }}
          onDelete={async (event) => {
            // Only events you typed in yourself are deleted; imported and official ones are hidden
            const remove = event.source === 'manual' ? deleteEvent : hideEvent
            if (await run(() => remove(event))) setForm(null)
          }}
        />
      )}

      {games.length > 1 && (
        <div role="group" aria-label="Show events for" className="flex flex-wrap gap-1.5">
          {[{ id: 'all', label: 'All' }, ...games.map((g) => ({ id: g.id, label: shortName(g) }))].map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={activeFilter === chip.id}
              onClick={() => chooseFilter(chip.id)}
              className={`min-h-9 rounded-full border px-3.5 text-sm font-semibold ${
                activeFilter === chip.id ? 'border-accent bg-accent text-on-accent' : 'border-line text-muted hover:text-ink'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {/* Web events are played in a browser, outside the game, so they can be switched off as a group.
          The switch covers every game, so whether it shows must not depend on the game filter. */}
      {events !== null && (!showWeb || events.some((e) => e.kind === 'web_event')) && (
        <label className="flex min-h-9 w-fit items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showWeb}
            onChange={(e) => {
              const next = e.target.checked
              setShowWeb(next)
              void run(() => setShowWebEvents(next))
            }}
            className="size-4 accent-[var(--color-accent)]"
          />
          Show web events (all games)
        </label>
      )}

      {events !== null && data && games.length > 0 && (
        <>
          {open.length === 0 && (
            <p className="rounded-2xl border border-line bg-surface p-5 text-sm text-muted">
              No events to track{activeFilter === 'all' ? '' : ' for this game'}. Add one with the end date the game shows, and it will count down here, on Today
              and in your reminders.
            </p>
          )}

          {soon.length > 0 && <Section title="Ending soon" hint="Within 3 days">{soon.map(card)}</Section>}
          {later.length > 0 && <Section title="Current">{later.map(card)}</Section>}
          {upcoming.length > 0 && <Section title="Upcoming">{upcoming.map(card)}</Section>}

          <Timeline games={shownGames} events={open} now={now} onOpen={(e) => setForm({ mode: 'edit', event: e })} />

          {done.length > 0 && (
            <div className="flex flex-col gap-3">
              <button type="button" onClick={() => setShowDone(!showDone)} aria-expanded={showDone} className="min-h-9 self-start text-sm font-semibold text-accent hover:underline">
                {showDone ? 'Hide' : 'Show'} finished ({done.length})
              </button>
              {showDone && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{done.map(card)}</div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  )
}

function EventCard({ event, game, now, onEdit, onDone }: { event: GameEvent; game: Game | undefined; now: Date; onEdit: () => void; onDone: (done: boolean) => void }) {
  const start = event.starts_at ? new Date(event.starts_at) : null
  const end = new Date(event.ends_at)
  const isDone = !!event.completed_at
  const upcoming = !!start && start > now
  const left = end.getTime() - now.getTime()
  const urgent = !isDone && !upcoming && left <= SOON_MS
  // How much of the event has passed (only when its start is known)
  const passed = start && !upcoming ? Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100)) : null

  return (
    <article className={`flex flex-col gap-2 rounded-2xl border bg-surface p-4 ${urgent ? 'border-urgent' : 'border-line'}`}>
      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className={`size-2.5 rounded-sm ${gameBg(game)}`} />
          {shortName(game)}
          {event.kind === 'web_event' && <span className="rounded-full border border-line px-1.5 text-[10px]">Web event</span>}
          {event.source !== 'manual' && <span className="rounded-full border border-line px-1.5 text-[10px]">{event.origin === 'catalog' ? 'Official' : 'Auto-added'}</span>}
        </span>
        <span className={`font-semibold ${urgent ? 'text-urgent' : ''}`}>
          {isDone ? 'Done' : upcoming ? `Starts in ${formatDuration(start.getTime() - now.getTime())}` : `Ends in ${formatDuration(left)}`}
        </span>
      </div>

      <h3 className={`font-display text-lg font-semibold leading-snug ${isDone ? 'text-muted line-through' : ''}`}>{event.name}</h3>
      {event.note && <p className="text-sm text-muted">{event.note}</p>}
      {event.official_url && (
        <a href={event.official_url} target="_blank" rel="noreferrer" className="w-fit text-xs font-semibold text-accent hover:underline">
          Open the event page
        </a>
      )}

      {passed !== null && !isDone && (
        <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-line">
          <div className={`h-full ${urgent ? 'bg-urgent' : gameBg(game)}`} style={{ width: `${passed}%` }} />
        </div>
      )}

      {/* Date and buttons share a row, so cards stay short on a phone */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-xs text-muted">
          {upcoming ? `${formatWhen(start, now)} to ${formatWhen(end, now)}` : `Ends ${formatWhen(end, now)}`}
          {!event.remind && ' · no reminder'}
        </p>

        <div className="flex gap-1.5">
          {!upcoming && (
            <button type="button" onClick={() => onDone(!isDone)} className="min-h-9 rounded-lg border border-line px-3 text-xs font-semibold text-muted hover:text-ink">
              {isDone ? 'Not done' : 'Mark done'}
            </button>
          )}
          <button type="button" onClick={onEdit} className="min-h-9 rounded-lg border border-line px-3 text-xs font-semibold text-muted hover:text-ink">
            Edit
          </button>
        </div>
      </div>
    </article>
  )
}

// ---- Timeline: one bar per event and per endgame cycle, over the next six weeks (three on a phone) ----

function Timeline({ games, events, now, onOpen }: { games: Game[]; events: GameEvent[]; now: Date; onOpen: (event: GameEvent) => void }) {
  // A phone shows fewer weeks so the whole timeline fits the screen without scrolling sideways
  const phone = useMedia(PHONE)
  const beforeDays = phone ? 1 : 2
  const days = phone ? 21 : 44
  // Bars narrower than this put their name beside the bar instead of inside it
  const minInside = phone ? 40 : 12
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - beforeDays).getTime()
  const span = days * DAY
  const percent = (t: number) => Math.min(100, Math.max(0, ((t - from) / span) * 100))
  const weeks = Array.from({ length: Math.ceil(days / 7) }, (_, i) => new Date(from + i * 7 * DAY))

  const groups = games
    .map((game) => {
      const bars: { key: string; label: string; start: number; end: number; openStart?: boolean; event?: GameEvent }[] = []
      for (const e of events.filter((x) => x.game_id === game.id)) {
        // No start date means it's already running; the bar fades in from the left edge
        const start = e.starts_at ? new Date(e.starts_at).getTime() : from
        bars.push({ key: e.id, label: e.name, start, end: new Date(e.ends_at).getTime(), openStart: !e.starts_at, event: e })
      }
      // Events in the order they start (then end), like a schedule
      bars.sort((a, b) => a.start - b.start || a.end - b.end)
      // Endgame cycles come from the reset rules, so they fill in on their own; they go first
      const cycles: typeof bars = []
      for (const t of game.tasks.filter((x) => x.category === 'endgame' && isVisible(x))) {
        const period = taskPeriod(t, clockOf(game), now)
        if (period?.end) cycles.push({ key: t.id, label: t.title, start: period.start.getTime(), end: period.end.getTime() })
      }
      cycles.sort((a, b) => a.end - b.end)
      return { game, bars: [...cycles, ...bars].filter((b) => b.end > from && b.start < from + span) }
    })
    .filter((g) => g.bars.length > 0)

  if (groups.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <h2 className="text-sm font-semibold">Timeline · next {phone ? 3 : 6} weeks</h2>
        <span className="text-xs text-muted">Solid bars are events, outlined bars are endgame cycles. A faded edge means it was already running.</span>
      </div>
      <div className="rounded-2xl border border-line bg-surface md:overflow-x-auto">
        <div className="relative p-3 md:min-w-[760px] md:p-4">
          {/* Week marks */}
          <div className="relative h-5 text-[11px] text-muted">
            {weeks.map((w) => (
              <span key={w.getTime()} className="absolute top-0 border-l border-line pl-1.5" style={{ left: `${percent(w.getTime())}%` }}>
                {w.toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </span>
            ))}
          </div>

          <div className="relative mt-1 flex flex-col gap-4">
            {/* Today: drawn behind the bars and names */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-0 w-px bg-ink/50" style={{ left: `${percent(now.getTime())}%` }} />

            {groups.map(({ game, bars }) => (
              <div key={game.id} className="flex flex-col gap-1.5">
                <span className="relative z-10 flex w-fit items-center gap-2 bg-surface pr-2 text-xs font-semibold text-muted">
                  <span aria-hidden="true" className={`size-2.5 rounded-sm ${gameBg(game)}`} />
                  {game.name}
                </span>
                {bars.map((bar) => {
                  const left = percent(bar.start)
                  const right = percent(bar.end)
                  const width = Math.max(2, right - left)
                  const style = { left: `${left}%`, width: `${width}%` }
                  const title = `${bar.label} · ends ${formatWhen(new Date(bar.end), now)}`
                  // A short bar gets its name beside it, on whichever side has more room
                  const inside = width >= minInside
                  const nameOnLeft = left > 100 - right
                  const outsideStyle = nameOnLeft ? { right: `${100 - left}%`, maxWidth: `${left}%` } : { left: `${right}%`, maxWidth: `${100 - right}%` }
                  const outsideClass = `absolute inset-y-0 z-10 flex items-center truncate px-2 text-xs ${nameOnLeft ? 'justify-end' : ''}`
                  return (
                    <div key={bar.key} className="relative h-7">
                      {bar.event ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onOpen(bar.event!)}
                            title={title}
                            aria-label={inside ? undefined : bar.label}
                            style={style}
                            className={`absolute inset-y-0 z-10 truncate px-2 text-left text-xs font-semibold text-on-accent ${gameBg(game)} ${bar.openStart ? 'rounded-r-md pl-6' : 'rounded-md'}`}
                          >
                            {bar.openStart && (
                              <span aria-hidden="true" className="absolute inset-y-0 left-0 w-5" style={{ background: 'linear-gradient(to right, var(--color-surface), transparent)' }} />
                            )}
                            {inside && bar.label}
                          </button>
                          {!inside && (
                            <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => onOpen(bar.event!)} style={outsideStyle} className={`${outsideClass} font-semibold text-ink`}>
                              <span className="truncate">{bar.label}</span>
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <span title={title} style={style} className="absolute inset-y-0 z-10 flex items-center truncate rounded-md border border-line bg-raised px-2 text-xs text-muted">
                            {inside && <span className="truncate">{bar.label}</span>}
                          </span>
                          {!inside && (
                            <span style={outsideStyle} className={`${outsideClass} text-muted`}>
                              <span className="truncate">{bar.label}</span>
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ---- Add / edit form. Dates are entered in the game's server time, as the game shows them. ----

type FormProps = {
  games: Game[]
  editing: GameEvent | null
  defaultGameId: string
  now: Date
  onCancel: () => void
  onSave: (input: EventInput, keepOpen: boolean) => Promise<boolean>
  onDelete: (event: GameEvent) => Promise<void>
}

function EventForm({ games, editing, defaultGameId, now, onCancel, onSave, onDelete }: FormProps) {
  const first = games.find((g) => g.id === (editing?.game_id ?? defaultGameId)) ?? games[0]
  const initialEnd = editing ? serverParts(editing.ends_at, first.timezone) : { date: '', time: minuteBefore(first.daily_reset_time) }
  const initialStart = editing?.starts_at ? serverParts(editing.starts_at, first.timezone) : { date: '', time: '10:00' }

  const [gameId, setGameId] = useState(first.id)
  const [name, setName] = useState(editing?.name ?? '')
  const [endDate, setEndDate] = useState(initialEnd.date)
  const [endTime, setEndTime] = useState(initialEnd.time)
  const [startDate, setStartDate] = useState(initialStart.date)
  const [startTime, setStartTime] = useState(initialStart.time)
  const [note, setNote] = useState(editing?.note ?? '')
  const [remind, setRemind] = useState(editing?.remind ?? true)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [added, setAdded] = useState(0)
  const imported = !!editing && editing.source !== 'manual'
  // Shared events from the official announcements: the name and dates are not yours to change
  const official = editing?.origin === 'catalog'

  const game = games.find((g) => g.id === gameId) ?? first
  const preset = findPreset(game.preset_id)
  const zone = findServer(preset, game.server)?.label ?? 'game'

  const changeGame = (id: string) => {
    const next = games.find((g) => g.id === id)
    setGameId(id)
    // Keep a time the player typed; otherwise follow the new game's reset
    if (next && endTime === minuteBefore(game.daily_reset_time)) setEndTime(minuteBefore(next.daily_reset_time))
  }

  const submit = async (keepOpen: boolean) => {
    if (official && editing) {
      setProblem(null)
      setSaving(true)
      await onSave({ game_id: editing.game_id, name: editing.name, starts_at: editing.starts_at, ends_at: editing.ends_at, note: note.trim() || null, remind }, false)
      setSaving(false)
      return
    }
    const title = name.trim()
    if (!title) return setProblem('Give the event a name.')
    const endsAt = toInstant(endDate, endTime, game.timezone)
    if (!endsAt) return setProblem('Pick the date the event ends.')
    if (new Date(endsAt) <= now) return setProblem('That end time has already passed.')
    const startsAt = startDate ? toInstant(startDate, startTime, game.timezone) : null
    if (startDate && !startsAt) return setProblem('Pick a start time, or clear the start date.')
    if (startsAt && startsAt >= endsAt) return setProblem('The start has to be before the end.')

    setProblem(null)
    setSaving(true)
    const ok = await onSave({ game_id: game.id, name: title, starts_at: startsAt, ends_at: endsAt, note: note.trim() || null, remind }, keepOpen)
    setSaving(false)
    if (ok && keepOpen) {
      // Ready for the next event of the same game
      setName('')
      setNote('')
      setAdded((n) => n + 1)
    }
  }

  // Editing starts from a card or a timeline bar further down the page, so bring the form into view
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  const field = 'min-h-10 rounded-lg border border-line bg-page px-3 text-sm text-ink placeholder:text-muted [color-scheme:dark] disabled:opacity-60'

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(false)
      }}
    >
      <h2 className="text-sm font-semibold">{editing ? 'Edit event' : 'Add event'}</h2>
      {official ? (
        <p className="-mt-2 text-xs text-muted">From the official announcements. The name and dates are kept up to date for you; the note and the reminder choice are yours.</p>
      ) : (
        imported && <p className="-mt-2 text-xs text-muted">Added automatically from the Genshin announcements. Your changes are kept; the import won't overwrite them.</p>
      )}

      <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="event-game" className="text-xs text-muted">Game</label>
          <select id="event-game" value={gameId} onChange={(e) => changeGame(e.target.value)} disabled={official} className={field}>
            {games.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="event-name" className="text-xs text-muted">Event name</label>
          <input id="event-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus={!editing} disabled={official} className={field} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="event-end-date" className="text-xs text-muted">Ends</label>
          <div className="flex gap-2">
            <input id="event-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={official} className={`${field} min-w-0 flex-1`} />
            <input aria-label="End time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={official} className={field} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="event-start-date" className="text-xs text-muted">Starts (leave empty if it is already running)</label>
          <div className="flex gap-2">
            <input id="event-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={official} className={`${field} min-w-0 flex-1`} />
            <input aria-label="Start time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={official} className={field} />
          </div>
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted">Dates and times are in {zone} server time, as the game shows them.</p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="event-note" className="text-xs text-muted">Progress note (optional)</label>
        <input id="event-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. 3 of 5 stages" className={field} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
        Remind me on Discord before it ends
      </label>

      {problem && <p className="text-sm text-urgent">{problem}</p>}
      {added > 0 && !problem && <p className="text-sm text-muted">Added {added} {added === 1 ? 'event' : 'events'}. Enter the next one, or close.</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={saving} className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent disabled:opacity-40">
          {editing ? 'Save changes' : 'Add event'}
        </button>
        {!editing && (
          <button type="button" disabled={saving} onClick={() => void submit(true)} className="min-h-10 rounded-lg border border-line px-4 text-sm font-semibold text-muted hover:text-ink disabled:opacity-40">
            Add and enter another
          </button>
        )}
        <button type="button" onClick={onCancel} className="min-h-10 rounded-lg px-3 text-sm text-muted hover:text-ink">
          {added > 0 ? 'Close' : 'Cancel'}
        </button>

        {editing &&
          (confirmDelete ? (
            <span className="ml-auto flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">{imported ? "Hide this event? It won't come back on its own." : 'Delete this event?'}</span>
              <button type="button" onClick={() => void onDelete(editing)} className="min-h-10 rounded-lg border border-urgent px-3 font-semibold text-urgent">
                {imported ? 'Yes, hide' : 'Yes, delete'}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-10 rounded-lg px-2 text-muted hover:text-ink">
                Keep
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="ml-auto min-h-10 rounded-lg px-3 text-sm text-muted hover:text-urgent">
              {imported ? 'Hide' : 'Delete'}
            </button>
          ))}
      </div>
    </form>
  )
}
