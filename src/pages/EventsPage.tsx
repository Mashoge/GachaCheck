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
import { Button, Card, Switch, ToggleGroup } from '../components/ui'

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
            <Button variant="secondary" onClick={() => setForm({ mode: 'import' })}>
              Import list
            </Button>
            <Button variant="primary" onClick={() => setForm({ mode: 'add' })}>
              Add event
            </Button>
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
        <ToggleGroup
          label="Show events for"
          value={activeFilter}
          onChange={chooseFilter}
          options={[{ id: 'all', label: 'All' }, ...games.map((g) => ({ id: g.id, label: shortName(g) }))]}
        />
      )}

      {/* Web events are played in a browser, outside the game, so they can be switched off as a group.
          The switch covers every game, so whether it shows must not depend on the game filter. */}
      {events !== null && (!showWeb || events.some((e) => e.kind === 'web_event')) && (
        <div className="flex min-h-9 w-fit items-center gap-2 text-sm text-muted">
          <Switch
            label="Show web events (all games)"
            on={showWeb}
            onChange={(next) => {
              setShowWeb(next)
              void run(() => setShowWebEvents(next))
            }}
          />
          <span>Show web events (all games)</span>
        </div>
      )}

      {events !== null && data && games.length > 0 && (
        <>
          {open.length === 0 && (
            <Card as="p" className="text-sm text-muted">
              No events to track{activeFilter === 'all' ? '' : ' for this game'}. Add one with the end date the game shows, and it will count down here, on Today
              and in your reminders.
            </Card>
          )}

          {soon.length > 0 && <Section title="Ending soon" hint="Within 3 days">{soon.map(card)}</Section>}
          {later.length > 0 && <Section title="Current">{later.map(card)}</Section>}
          {upcoming.length > 0 && <Section title="Upcoming">{upcoming.map(card)}</Section>}

          <Timeline games={shownGames} events={open} now={now} onOpen={(e) => setForm({ mode: 'edit', event: e })} />

          {done.length > 0 && (
            <div className="flex flex-col gap-3">
              <Button variant="link" size="sm" className="self-start" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
                {showDone ? 'Hide' : 'Show'} finished ({done.length})
              </Button>
              {showDone && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{done.map(card)}</div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
