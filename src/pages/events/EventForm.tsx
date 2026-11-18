import { useEffect, useRef, useState } from 'react'
import { findPreset, findServer } from '../../data/presets'
import type { EventInput, GameEvent } from '../../lib/events'
import { minuteBefore, serverParts, toInstant } from '../../lib/eventTime'
import type { HiddenEvent } from '../../lib/hiddenEvents'
import type { Game } from '../../lib/today'
import { Button, Card, Field, Input, Select, Switch, useConfirm } from '../../components/ui'

// ---- Add / edit form. Dates are entered in the game's server time, as the game shows them. ----

type FormProps = {
  games: Game[]
  editing: GameEvent | null
  defaultGameId: string
  now: Date
  onCancel: () => void
  onSave: (input: EventInput, keepOpen: boolean) => Promise<boolean>
  onDelete: (event: GameEvent) => Promise<void>
  /** The hidden official event a new event would be swallowed by (the list never shows a copy of an official event) */
  findHidden?: (input: EventInput) => HiddenEvent | null
  /** Puts a hidden event back. Returns false if it failed. */
  onRestore?: (event: HiddenEvent) => Promise<boolean>
}

export function EventForm({ games, editing, defaultGameId, now, onCancel, onSave, onDelete, findHidden, onRestore }: FormProps) {
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
  const confirm = useConfirm()
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
    const input: EventInput = { game_id: game.id, name: title, starts_at: startsAt, ends_at: endsAt, note: note.trim() || null, remind }

    // A new event that matches an official one you hid would be saved but never shown, so offer the official one back
    const hiddenOfficial = !editing && onRestore ? (findHidden?.(input) ?? null) : null
    if (hiddenOfficial && onRestore) {
      const restore = await confirm({
        title: `"${hiddenOfficial.name}" is hidden`,
        message: 'You hid this official event earlier. An event you add with the same name and end date won’t show while the official one exists. Restore the official event instead?',
        confirmLabel: 'Restore event',
        cancelLabel: 'Keep editing',
      })
      if (!restore) return
      setSaving(true)
      const ok = await onRestore(hiddenOfficial)
      setSaving(false)
      if (!ok) return
      if (!keepOpen) return onCancel()
      setName('')
      setNote('')
      return
    }

    setSaving(true)
    const ok = await onSave(input, keepOpen)
    setSaving(false)
    if (ok && keepOpen) {
      // Ready for the next event of the same game
      setName('')
      setNote('')
      setAdded((n) => n + 1)
    }
  }

  const removeOrHide = async () => {
    if (!editing) return
    if (!imported) {
      const confirmed = await confirm({
        title: `Delete "${editing.name}"?`,
        message: 'This event will be permanently removed from your list. This cannot be undone.',
        confirmLabel: 'Delete event',
        danger: true,
      })
      if (!confirmed) return
    }
    await onDelete(editing)
  }

  // Editing starts from a card or a timeline bar further down the page, so bring the form into view
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])


  return (
    <Card as="section" padding="none" className="gc-set">
      <form
        ref={formRef}
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(false)
        }}
      >
      {/* THM-9: the same heading band as the game page panels */}
      <div className="-mx-5 -mt-5 border-b border-line px-5 py-3.5">
        <h2 className="gc-label flex items-center"><span aria-hidden="true" className="gc-tick" />{editing ? 'Edit event' : 'Add event'}</h2>
      </div>
      {official ? (
        <p className="-mt-2 text-xs text-muted">From the official announcements. The name and dates are kept up to date for you; the note and the reminder choice are yours.</p>
      ) : (
        imported && <p className="-mt-2 text-xs text-muted">Added automatically from the Genshin announcements. Your changes are kept; the import won't overwrite them.</p>
      )}

      <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
        <Field id="event-game" label="Game" labelSize="sm">
          <Select value={gameId} onChange={(e) => changeGame(e.target.value)} disabled={official}>
            {games.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </Select>
        </Field>
        <Field id="event-name" label="Event name" labelSize="sm">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus={!editing} disabled={official} />
        </Field>
      </div>

      {/* The schedule: one band with two columns instead of boxes inside boxes */}
      <section aria-labelledby="event-schedule-title" className="rounded-xl border border-line bg-raised p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id="event-schedule-title" className="gc-label">Schedule</h3>
          <span className="gc-tag" data-tone="rest">{zone} server time</span>
        </div>

        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">Starts</span>
              <span className="gc-tag" data-tone="rest">Optional</span>
            </div>
            <p className="mb-2.5 text-xs leading-relaxed text-muted">Leave blank if the event is already running.</p>
            <div className="flex min-w-0 gap-2">
              <Field id="event-start-date" label="Start date" hideLabel className="min-w-0 flex-1">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={official} className="w-full min-w-0" />
              </Field>
              <Field id="event-start-time" label="Start time" hideLabel className="w-32 shrink-0">
                <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={official} className="w-full" />
              </Field>
            </div>
          </div>

          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">Ends</span>
              <span className="gc-tag">Required</span>
            </div>
            <p className="mb-2.5 text-xs leading-relaxed text-muted">The final date and time players can take part.</p>
            <div className="flex min-w-0 gap-2">
              <Field id="event-end-date" label="End date" hideLabel className="min-w-0 flex-1">
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={official} className="w-full min-w-0" />
              </Field>
              <Field id="event-end-time" label="End time" hideLabel className="w-32 shrink-0">
                <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={official} className="w-full" />
              </Field>
            </div>
          </div>
        </div>
      </section>

      <Field id="event-note" label="Progress note (optional)" labelSize="sm">
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. 3 of 5 stages" />
      </Field>

      <div className="flex items-center gap-2 text-sm text-muted">
        <Switch label="Remind me on Discord before it ends" on={remind} onChange={setRemind} />
        <span>Remind me on Discord before it ends</span>
      </div>

      {problem && <p className="text-sm text-urgent">{problem}</p>}
      {added > 0 && !problem && <p className="text-sm text-muted">Added {added} {added === 1 ? 'event' : 'events'}. Enter the next one, or close.</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={saving}>
          {editing ? 'Save changes' : 'Add event'}
        </Button>
        {!editing && (
          <Button type="button" variant="secondary" disabled={saving} onClick={() => void submit(true)}>
            Add and enter another
          </Button>
        )}
        <Button type="button" variant="quiet" onClick={onCancel}>
          {added > 0 ? 'Close' : 'Cancel'}
        </Button>

        {editing && (
          <Button
            type="button"
            variant={imported ? 'quiet' : 'danger'}
            className="ml-auto"
            disabled={saving}
            onClick={() => void removeOrHide()}
          >
            {imported ? 'Hide from list' : 'Delete event'}
          </Button>
        )}
      </div>
      </form>
    </Card>
  )
}
