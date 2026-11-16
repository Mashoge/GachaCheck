import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { messageOf } from '../lib/errors'
import { addEvent, addEvents, deleteEvent, fetchEvents, fetchShowWebEvents, hideEvent, setEventDone, setShowWebEvents, updateEvent, type GameEvent } from '../lib/events'
import { useTodayData, type Game } from '../lib/today'
import { SHORT_NAMES } from '../lib/useGames'
import EventImport from './EventImport'
import { useNow } from '../lib/useNow'
import { useRefreshOnFocus } from '../lib/useRefreshOnFocus'
import { EventCard, Section, Timeline } from './events/EventDisplay'
import { EventForm } from './events/EventForm'

const SOON_MS = 3 * 86_400_000
const FILTER_KEY = 'gachacheck.events.filter'
const shortName = (game: Game) => SHORT_NAMES[game.preset_id ?? ''] ?? game.name

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

  const fetchData = useCallback(() => Promise.all([fetchEvents(), fetchShowWebEvents()]), [])

  const refresh = useCallback(async () => {
    try {
      const [list, web] = await fetchData()
      setEvents(list)
      setShowWeb(web)
      setError(null)
    } catch (err) {
      setError(messageOf(err))
    }
  }, [fetchData])
  useRefreshOnFocus(refresh)

  useEffect(() => {
    let active = true
    const load = () => {
      void fetchData()
        .then(([list, web]) => {
          if (!active) return
          setEvents(list)
          setShowWeb(web)
          setError(null)
        })
        .catch((err: unknown) => {
          if (active) setError(messageOf(err))
        })
    }

    load()
    return () => {
      active = false
    }
  }, [fetchData])

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
  const upcoming = open.filter((e) => e.starts_at && new Date(e.starts_at) > now).sort((a, b) => a.starts_at!.localeCompare(b.starts_at!) || a.name.localeCompare(b.name))
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
