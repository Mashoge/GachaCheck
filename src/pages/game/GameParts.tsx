import { useState, type CSSProperties } from 'react'
import { overCapBy, type MeterRow, type MeterState } from '../../lib/stamina'
import { zonedTime } from '../../lib/time'
import type { Task } from '../../lib/today'
import { Button, Input } from '../../components/ui'

// Ticks, bars and tags take the game's colour on its page (--gc, from .gc-set in GameDashboard)
export function Check({ done }: { done: boolean }) {
  return (
    <span aria-hidden="true" className="gc-check" data-done={done ? '' : undefined}>
      {done && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l5 5L20 7" />
        </svg>
      )}
    </span>
  )
}

export function TaskRow({ task, done, onToggle, meta }: { task: Task; done: boolean; onToggle: () => void; meta?: string }) {
  return (
    <Button
      variant="quiet"
      aria-pressed={done}
      onClick={onToggle}
      className="flex min-h-12 w-full items-center justify-start gap-3 rounded-none border-b border-line py-2 text-left"
      style={{ display: 'flex', justifyContent: 'flex-start', minHeight: 48, paddingInline: 0, borderRadius: 0 }}
    >
      <Check done={done} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex flex-wrap items-center gap-2">
          <span className={`text-sm ${done ? 'text-muted line-through' : ''}`}>{task.title}</span>
          {task.optional && <span className="gc-tag" data-tone="rest">Optional</span>}
        </span>
        {task.note && !done && <span className="text-xs text-muted">{task.note}</span>}
      </span>
      {meta && <span className="whitespace-nowrap text-xs text-muted">{meta}</span>}
    </Button>
  )
}

// "Set end date" for endgame modes whose dates change each cycle. The time is the server's, as the game shows it.
export function EndDateEditor({ task, active, timezone, zoneLabel, now, onSave }: { task: Task; active: boolean; timezone: string; zoneLabel: string; now: Date; onSave: (endsAt: string, startDay: string | null) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [startDraft, setStartDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const id = `ends-${task.id}`

  const open = () => {
    setDraft(active && task.cycle_ends_at ? task.cycle_ends_at.replace(' ', 'T').slice(0, 16) : '')
    setStartDraft(active && task.cycle_anchor ? task.cycle_anchor.slice(0, 10) : '')
    setProblem(null)
    setEditing(true)
  }

  const save = () => {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(draft)
    if (!match) return setProblem('Pick a date and a time.')
    const [y, m, d, h, mi] = match.slice(1).map(Number)
    const end = zonedTime(y, m, d, h, mi, timezone)
    if (end <= now) return setProblem('That time has already passed.')
    if (startDraft) {
      const [sy, sm, sd] = startDraft.split('-').map(Number)
      const start = zonedTime(sy, sm, sd, 0, 0, timezone)
      if (start >= end) return setProblem('The start has to be before the end.')
      if (end.getTime() - start.getTime() > 60 * 86_400_000) return setProblem('A cycle can be at most 60 days long.')
    }
    onSave(draft, startDraft || null)
    setEditing(false)
  }

  if (!editing) {
    return (
      <Button variant="link" size="sm" className="self-start px-4 pb-2" onClick={open}>
        {active ? 'Change dates' : 'Set dates'}
      </Button>
    )
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <p className="w-full text-xs text-muted">Enter the dates in {zoneLabel} server time, as the game shows them.</p>
      <label htmlFor={id} className="w-14 text-xs text-muted">Ends</label>
      <Input
        id={id}
        type="datetime-local"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="min-w-0 flex-1"
      />
      <span className="w-full" />
      <label htmlFor={`${id}-start`} className="w-14 text-xs text-muted">Starts</label>
      <Input
        id={`${id}-start`}
        type="date"
        value={startDraft}
        onChange={(e) => setStartDraft(e.target.value)}
        className="min-w-0 flex-1"
      />
      <p className="w-full text-xs text-muted">Starts is optional. Set it when the mode opens later, like Endstate Matrix 7 days into a version.</p>
      <Button type="submit" variant="primary">Save</Button>
      <Button type="button" variant="quiet" onClick={() => setEditing(false)}>Cancel</Button>
      {problem && <p className="w-full text-xs text-urgent">{problem}</p>}
    </form>
  )
}

export function CountedRow({ task, progress, onAdd, onUndo }: { task: Task; progress: { count: number; target: number; done: boolean; today: boolean; doneForNow: boolean }; onAdd: () => void; onUndo: () => void }) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-b border-line py-2">
      <Check done={progress.doneForNow} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`text-sm ${progress.doneForNow ? 'text-muted' : ''}`}>
          {task.title}
          {progress.today && !progress.done && <span className="ml-2 text-xs">· done today</span>}
        </span>
        {task.note && !progress.done && <span className="text-xs text-muted">{task.note}</span>}
        <span aria-hidden="true" className="gc-slant-bar block max-w-48 !h-1.5">
          <i style={{ width: `${Math.min(100, (progress.count / progress.target) * 100)}%`, background: 'var(--gc, var(--color-accent))' }} />
        </span>
      </span>
      <span className="font-display text-sm font-semibold">{progress.count}<span className="text-muted">/{progress.target}</span></span>
      <Button
        size="sm"
        variant="secondary"
        icon
        onClick={onUndo}
        disabled={progress.count === 0}
        aria-label={`Remove one from ${task.title}`}
      >
        −
      </Button>
      <Button
        size="sm"
        variant="secondary"
        icon
        onClick={onAdd}
        disabled={progress.done || progress.today}
        aria-label={`Add one to ${task.title}`}
      >
        +
      </Button>
    </div>
  )
}

export function MeterCard({ state, row, sub, estimated, onSet }: { state: MeterState; row: MeterRow & { preset_key?: string | null }; sub: string; estimated: boolean; onSet: (value: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const spends = row.spend_presets && row.spend_presets.length > 0 ? row.spend_presets : [20, 40, 60]
  const pct = Math.min(100, Math.round((state.value / state.cap) * 100))

  const save = () => {
    const v = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(v) || v < 0) return
    onSet(v)
    setEditing(false)
  }

  return (
    <div className="flex flex-col gap-2">
      {/* The name and its tags wrap onto a second line when space is short; the number never breaks */}
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="gc-label">{state.name}</span>
        {estimated && <span className="gc-tag" data-tone="rest">Estimated</span>}
        {/* STA-1: going over the cap after a refill is allowed, and shown as such */}
        {overCapBy(state) > 0 && <span className="gc-tag">+{overCapBy(state)} over cap</span>}
      </span>
      <span className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span className={`font-display text-4xl font-bold leading-none tracking-tight ${state.full ? 'text-urgent' : ''}`}>{state.value}</span>
        <span className="font-display text-base font-semibold text-muted">/{state.cap}</span>
      </span>
      <span aria-hidden="true" className="gc-meter" style={{ '--p': `${pct}%` } as CSSProperties}>
        <i style={state.full ? { background: 'var(--color-urgent)' } : undefined} />
      </span>
      <span className={`text-xs ${state.full ? 'text-urgent' : 'text-muted'}`}>{sub}</span>

      {editing ? (
        <form
          className="mt-1 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <label className="sr-only" htmlFor={`meter-${row.id}`}>{state.name} right now</label>
          <Input
            id={`meter-${row.id}`}
            type="number"
            inputMode="numeric"
            min={0}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`What the game shows (cap ${state.cap})`}
            className="w-0 min-w-0 flex-1"
          />
          <Button type="submit" variant="primary">Save</Button>
          <Button type="button" variant="quiet" onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {!state.isOverflow &&
            spends.map((n) => (
              <Button
                key={n}
                size="sm"
                variant="secondary"
                onClick={() => onSet(Math.max(0, state.value - n))}
                aria-label={`Spent ${n} ${state.name}`}
                className="px-2.5"
              >
                −{n}
              </Button>
            ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setDraft(String(state.value))
              setEditing(true)
            }}
            className="px-2.5"
          >
            Set value
          </Button>
        </div>
      )}
    </div>
  )
}
