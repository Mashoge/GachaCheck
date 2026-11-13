import { useState } from 'react'
import {
  addCustomTask,
  removeCustomTask,
  setTaskHidden,
  setWeeklyTarget,
  type CustomTaskKind,
  type GameSummary,
} from '../lib/games'
import { messageOf } from '../lib/errors'
import { findPreset } from '../data/presets'
import { Button, Input, Notice, Select, Tag, useConfirm } from './ui'

type Task = GameSummary['tasks'][number]

const GROUPS: { label: string; match: (t: Task) => boolean }[] = [
  { label: 'Daily', match: (t) => t.category === 'routine' && t.frequency === 'daily' },
  { label: 'Weekly', match: (t) => t.category === 'routine' && t.frequency === 'weekly' },
  { label: 'Monthly', match: (t) => t.category === 'routine' && t.frequency === 'monthly' },
  { label: 'Endgame', match: (t) => t.category === 'endgame' },
  { label: 'Goals', match: (t) => t.category === 'goal' },
]

function ordinal(n: number) {
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'
  return `${n}${suffix}`
}

function schedule(task: Task) {
  if (task.frequency === 'monthly' && task.monthly_day) return `Resets on the ${ordinal(task.monthly_day)}`
  if (task.frequency === 'interval' && task.cycle_days) return `Every ${task.cycle_days} days`
  if (task.frequency === 'dated') {
    return task.cycle_ends_at ? `Ends ${task.cycle_ends_at.replace('T', ' ').slice(0, 16)} server time` : 'Dates not set yet'
  }
  if (task.frequency === 'none') {
    return task.due_at ? `Due ${new Date(task.due_at).toLocaleDateString()}` : 'No due date'
  }
  return null
}

interface TaskManagerProps {
  game: GameSummary
  onChanged: () => Promise<void>
}

export default function TaskManager({ game, onChanged }: TaskManagerProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<CustomTaskKind>('daily')
  const [dueDate, setDueDate] = useState('')
  const [targetFor, setTargetFor] = useState<string | null>(null)
  const confirm = useConfirm()

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onChanged()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  function handleAdd() {
    const trimmed = title.trim()
    if (!trimmed) return
    const dueAt = kind === 'goal' && dueDate ? new Date(`${dueDate}T23:59`).toISOString() : null
    void run(async () => {
      await addCustomTask(game.id, { title: trimmed, kind, dueAt })
      setTitle('')
      setDueDate('')
    })
  }

  async function handleRemove(task: Task) {
    const ok = await confirm({ title: `Remove "${task.title}"?`, message: 'Its history goes with it.', confirmLabel: 'Remove', danger: true })
    if (ok) void run(() => removeCustomTask(task.id))
  }

  const active = game.tasks.filter((t) => !t.archived)
  const preset = findPreset(game.preset_id)

  return (
    <div className="space-y-4 border-t border-line pt-4">
      {GROUPS.map((group) => {
        const tasks = active.filter(group.match)
        if (tasks.length === 0) return null
        return (
          <section key={group.label} className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">{group.label}</h4>
            <ul className="space-y-1.5">
              {tasks.map((task) => {
                const isCustom = task.preset_key === null
                const hint = schedule(task)
                const presetTask = preset?.tasks.find((p) => p.key === task.preset_key)
                const showTarget = task.weekly_target !== null || targetFor === task.id
                const canSetTarget =
                  !showTarget && (isCustom ? task.frequency !== 'none' : Boolean(presetTask?.targetEditable))
                // With a target box, the name gets its own line on a phone so it isn't squeezed
                const extras = showTarget || canSetTarget
                return (
                  <li key={task.id}
                    className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-raised px-3 py-2 ${task.hidden ? 'opacity-50' : ''}`}>
                    <div className={`min-w-0 space-y-0.5 ${extras ? 'basis-full sm:basis-0 sm:flex-1' : 'flex-1'}`}>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span>{task.title}</span>
                        {task.optional && <Tag tone="neutral">Optional</Tag>}
                        {isCustom && <Tag tone="accent">Mine</Tag>}
                        {task.hidden && <span className="text-xs text-muted">Hidden</span>}
                      </div>
                      {(task.note || hint) && (
                        <p className="text-xs text-muted">{[hint, task.note].filter(Boolean).join(' · ')}</p>
                      )}
                    </div>

                    <div className="ml-auto flex shrink-0 items-center gap-3">
                      {showTarget && (
                        <label className="flex items-center gap-1.5 text-xs text-muted">
                          Target / week
                          <Input
                            size="sm"
                            key={`${task.id}-${task.weekly_target ?? ''}`}
                            type="number" min={1} max={50} disabled={busy}
                            autoFocus={targetFor === task.id}
                            defaultValue={task.weekly_target ?? ''}
                            onBlur={(e) => {
                              const value = e.target.value ? Number(e.target.value) : null
                              setTargetFor(null)
                              if (value !== task.weekly_target) void run(() => setWeeklyTarget(task.id, value))
                            }}
                            className="w-16"
                          />
                        </label>
                      )}
                      {canSetTarget && (
                        <Button variant="link" size="sm" disabled={busy} onClick={() => setTargetFor(task.id)}>
                          Set target
                        </Button>
                      )}

                      {isCustom ? (
                        <Button size="sm" disabled={busy} onClick={() => void handleRemove(task)}>
                          Remove
                        </Button>
                      ) : (
                        <Button size="sm" disabled={busy} onClick={() => void run(() => setTaskHidden(task.id, !task.hidden))}>
                          {task.hidden ? 'Show' : 'Hide'}
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleAdd()
        }}
        className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-line p-3"
      >
        <div className="flex min-w-[180px] flex-1 flex-col gap-1">
          <label htmlFor={`new-task-${game.id}`} className="text-xs text-muted">Add your own</label>
          <Input id={`new-task-${game.id}`} value={title} maxLength={80} placeholder={preset?.taskExample ?? 'e.g. Build a new character'}
            onChange={(e) => setTitle(e.target.value)} />
        </div>
        <label className="sr-only" htmlFor={`new-kind-${game.id}`}>Type</label>
        <Select id={`new-kind-${game.id}`} value={kind} onChange={(e) => setKind(e.target.value as CustomTaskKind)}>
          <option value="daily">Daily task</option>
          <option value="weekly">Weekly task</option>
          <option value="goal">Goal</option>
        </Select>
        {kind === 'goal' && (
          <>
            <label className="sr-only" htmlFor={`new-due-${game.id}`}>Due date (optional)</label>
            <Input id={`new-due-${game.id}`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </>
        )}
        <Button type="submit" variant="primary" disabled={busy || !title.trim()}>
          Add
        </Button>
      </form>

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}