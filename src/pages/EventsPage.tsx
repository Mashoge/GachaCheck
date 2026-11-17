import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { messageOf } from '../lib/errors'
import {
  addEvent, addEvents, deleteEvent, fetchEvents, fetchHiddenEvents, fetchShowWebEvents, hideEvent, restoreEvent, setEventDone, setShowWebEvents, updateEvent,
  type EventInput, type GameEvent,
} from '../lib/events'
import { hiddenFromEvent, hiddenMatch, toHiddenEvents, type HiddenEvent, type HiddenRows } from '../lib/hiddenEvents'
import { formatWhen } from '../lib/time'
import { useTodayData, type Game } from '../lib/today'
import { SHORT_NAMES } from '../lib/useGames'
import EventImport from './EventImport'
import { useNow } from '../lib/useNow'
import { useRefreshOnFocus } from '../lib/useRefreshOnFocus'
import { EventCard, Section, Timeline } from './events/EventDisplay'
import { EventForm } from './events/EventForm'
import { Button, Card, Notice, Switch, Tag, ToggleGroup, cx } from '../components/ui'

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
  // null = still loading; 'failed' = the rest of the page still works, only the hidden list is missing
  const [hiddenRows, setHiddenRows] = useState<HiddenRows | 'failed' | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [justHidden, setJustHidden] = useState<HiddenEvent | null>(null)

  const fetchData = useCallback(
    () => Promise.all([fetchEvents(), fetchShowWebEvents(), fetchHiddenEvents().catch((): 'failed' => 'failed')]),
    [],
  )

  const refresh = useCallback(async () => {
    try {
      const [list, web, hidden] = await fetchData()
      setEvents(list)
      setShowWeb(web)
      setHiddenRows(hidden)
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
        .then(([list, web, hidden]) => {
          if (!active) return
          setEvents(list)
          setShowWeb(web)
          setHiddenRows(hidden)
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

  const hidden = hiddenRows && hiddenRows !== 'failed' ? toHiddenEvents(hiddenRows, games, showWeb, now) : []
  const shownHidden = hidden.filter((e) => activeFilter === 'all' || e.game_id === activeFilter)

  // Every official event on the list, for spotting a new event that would be taken for a copy of a hidden one
  const visibleCatalog = (events ?? []).flatMap((e) =>
    e.origin === 'catalog' && e.catalog_event_id ? [{ catalogId: e.catalog_event_id, game_id: e.game_id, name: e.name, ends_at: e.ends_at }] : [],
  )
  const findHidden = (input: EventInput) => hiddenMatch(input, visibleCatalog, hidden)

  const restore = async (event: HiddenEvent) => {
    const ok = await run(() => restoreEvent(event))
    if (ok && justHidden?.key === event.key) setJustHidden(null)
    return ok
  }

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
            const manual = event.source === 'manual'
            if (!(await run(() => (manual ? deleteEvent(event) : hideEvent(event))))) return
            setForm(null)
            setJustHidden(manual ? null : hiddenFromEvent(event))
          }}
          findHidden={findHidden}
          onRestore={restore}
        />
      )}

      {/* Right after hiding: a way straight back. Kept until dismissed, so there is no timer to race. */}
      <div aria-live="polite">
        {justHidden && !form && (
          <Card padding="md" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="min-w-0 flex-1">
              Hid “{justHidden.name}”. You can restore it later from “Show hidden” at the bottom of this page.
            </span>
            <Button variant="link" size="sm" onClick={() => void restore(justHidden)}>
              Undo
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setJustHidden(null)}>
              Dismiss
            </Button>
          </Card>
        )}
      </div>

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

          {shownHidden.length > 0 && (
            <div className="flex flex-col gap-3">
              <Button variant="link" size="sm" className="self-start" onClick={() => setShowHidden(!showHidden)} aria-expanded={showHidden}>
                {showHidden ? 'Collapse' : 'Show'} hidden ({shownHidden.length})
              </Button>
              {showHidden && (
                <>
                  <Card as="ul" padding="none" aria-label="Hidden events" className="overflow-hidden">
                    {shownHidden.map((h, i) => {
                      const game = games.find((g) => g.id === h.game_id)
                      return (
                        <li key={h.key} className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3', i > 0 && 'border-t border-line')}>
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="text-sm font-medium">{h.name}</span>
                            <span className="text-xs text-muted">
                              {game ? shortName(game) : 'Unknown game'} · Ends {formatWhen(new Date(h.ends_at), now)}
                            </span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <Tag>{h.origin === 'catalog' ? 'Official' : 'Imported'}</Tag>
                            {h.kind === 'web_event' && <Tag>Web event</Tag>}
                          </span>
                          <Button size="sm" onClick={() => void restore(h)} aria-label={`Restore ${h.name}`}>
                            Restore
                          </Button>
                        </li>
                      )
                    })}
                  </Card>
                  <p className="text-xs text-muted">
                    Hidden events don't count down or send reminders. Restoring one brings back its done mark and note.
                  </p>
                </>
              )}
            </div>
          )}
          {hiddenRows === 'failed' && <Notice>Hidden events couldn't be loaded right now. The rest of the list is up to date.</Notice>}
        </>
      )}
    </div>
  )
}
