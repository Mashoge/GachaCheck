import { useEffect, useRef, useState } from 'react'
import { findPreset, findServer } from '../../data/presets'
import type { EventInput, GameEvent } from '../../lib/events'
import { minuteBefore, serverParts, toInstant } from '../../lib/eventTime'
import type { Game } from '../../lib/today'

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

export function EventForm({ games, editing, defaultGameId, now, onCancel, onSave, onDelete }: FormProps) {
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

      <section aria-labelledby="event-schedule-title" className="rounded-xl border border-line bg-page p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 id="event-schedule-title" className="text-sm font-semibold text-ink">Event schedule</h3>
            <p className="mt-1 text-xs text-muted">Set when the event opens and when it closes.</p>
          </div>
          <span className="rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-muted">
            {zone} server time
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-line bg-surface p-3">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="event-start-date" className="text-sm font-semibold text-ink">Starts</label>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Optional</span>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted">Leave blank if the event is already running.</p>
            <div className="flex gap-2">
              <input id="event-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={official} className={`${field} min-w-0 flex-1`} />
              <input aria-label="Start time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={official} className={field} />
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface p-3">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="event-end-date" className="text-sm font-semibold text-ink">Ends</label>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Required</span>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted">The final date and time players can participate.</p>
            <div className="flex gap-2">
              <input id="event-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={official} className={`${field} min-w-0 flex-1`} />
              <input aria-label="End time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={official} className={field} />
            </div>
          </div>
        </div>
      </section>

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
