import { useState, type Ref } from 'react'
import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import {
  addCustomTask,
  removeCustomTask,
  restoreCustomTask,
  reorderGameTasks,
  setTaskHidden,
  setWeeklyTarget,
  type CustomTaskKind,
  type GameSummary,
} from '../lib/games'
import { messageOf } from '../lib/errors'
import { findPreset } from '../data/presets'
import { moveTaskWithinGroup } from '../lib/taskOrdering'
import { Button, Input, Notice, Select, Tag } from './ui'

type Task = GameSummary['tasks'][number]

const GROUPS: { id: string; label: string; match: (t: Task) => boolean }[] = [
  { id: 'daily', label: 'Daily', match: (t) => t.category === 'routine' && t.frequency === 'daily' },
  { id: 'weekly', label: 'Weekly', match: (t) => t.category === 'routine' && t.frequency === 'weekly' },
  { id: 'monthly', label: 'Monthly', match: (t) => t.category === 'routine' && t.frequency === 'monthly' },
  { id: 'endgame', label: 'Endgame', match: (t) => t.category === 'endgame' },
  { id: 'goals', label: 'Goals', match: (t) => t.category === 'goal' },
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

interface SortableTaskRowProps {
  task: Task
  index: number
  group: string
  disabled: boolean
  extras: boolean
  showTarget: boolean
  canSetTarget: boolean
  targetFor: string | null
  onTargetBlur: (task: Task, value: number | null) => void
  onSetTarget: (taskId: string) => void
  onRemove: (task: Task) => void
  onToggleHidden: (task: Task) => void
}

function GripIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="8" cy="5" r="1.35" fill="currentColor" />
      <circle cx="16" cy="5" r="1.35" fill="currentColor" />
      <circle cx="8" cy="12" r="1.35" fill="currentColor" />
      <circle cx="16" cy="12" r="1.35" fill="currentColor" />
      <circle cx="8" cy="19" r="1.35" fill="currentColor" />
      <circle cx="16" cy="19" r="1.35" fill="currentColor" />
    </svg>
  )
}

function SortableTaskRow({
  task,
  index,
  group,
  disabled,
  extras,
  showTarget,
  canSetTarget,
  targetFor,
  onTargetBlur,
  onSetTarget,
  onRemove,
  onToggleHidden,
}: SortableTaskRowProps) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: task.id,
    index,
    group,
    type: group,
    accept: group,
    disabled,
  })
  const isCustom = task.preset_key === null
  const hint = schedule(task)

  return (
    <li
      ref={ref as Ref<HTMLLIElement>}
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-raised px-2 py-2 transition-colors ${
        task.hidden ? 'opacity-50 ' : ''
      }${isDragging ? 'border-accent opacity-60 shadow-lg ' : isDropTarget ? 'border-accent ' : 'border-transparent '}`}
    >
      <button
        ref={handleRef as Ref<HTMLButtonElement>}
        type="button"
        className="flex h-11 w-11 shrink-0 touch-none select-none items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-ink active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30"
        aria-label={`Reorder ${task.title}`}
        title="Drag to reorder. Press Space or Enter, use arrow keys, then Space or Enter to drop."
        disabled={disabled}
      >
        <GripIcon />
      </button>

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
              type="number" min={1} max={50} disabled={disabled}
              autoFocus={targetFor === task.id}
              defaultValue={task.weekly_target ?? ''}
              onBlur={(e) => {
                const value = e.target.value ? Number(e.target.value) : null
                onTargetBlur(task, value)
              }}
              className="w-16"
            />
          </label>
        )}
        {canSetTarget && (
          <Button variant="link" size="sm" disabled={disabled} onClick={() => onSetTarget(task.id)}>
            Set target
          </Button>
        )}

        {isCustom ? (
          <Button size="md" variant="danger" disabled={disabled} onClick={() => onRemove(task)}>
            Remove
          </Button>
        ) : (
          <Button size="md" disabled={disabled} onClick={() => onToggleHidden(task)}>
            {task.hidden ? 'Show' : 'Hide'}
          </Button>
        )}
      </div>
    </li>
  )
}

export default function TaskManager({ game, onChanged }: TaskManagerProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<CustomTaskKind>('daily')
  const [dueDate, setDueDate] = useState('')
  const [targetFor, setTargetFor] = useState<string | null>(null)
  const [removedTask, setRemovedTask] = useState<{ id: string; title: string } | null>(null)

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

  async function persistOrder(taskIds: string[]) {
    setBusy(true)
    setError(null)
    try {
      await reorderGameTasks(game.id, taskIds)
      await onChanged()
    } catch (err) {
      setError(messageOf(err))
      // The sortable UI previews the new position during a drag. Re-fetch persisted data
      // after a failed write so the list snaps back to the server's authoritative order.
      try {
        await onChanged()
      } catch {
        // Keep the original reorder error visible; the next refresh can retry the read.
      }
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

  function handleRemove(task: Task) {
    void run(async () => {
      await removeCustomTask(task.id)
      setRemovedTask({ id: task.id, title: task.title })
    })
  }

  function handleUndoRemove() {
    if (!removedTask) return
    const task = removedTask
    void run(async () => {
      await restoreCustomTask(task.id)
      setRemovedTask(null)
    })
  }

  const active = game.tasks.filter((t) => !t.archived)
  const preset = findPreset(game.preset_id)

  return (
    <div className="space-y-4 border-t border-line pt-4">
      <DragDropProvider
        sensors={(defaults) => [
          ...defaults.filter((sensor) => sensor !== PointerSensor),
          PointerSensor.configure({
            activationConstraints(event) {
              if (event.pointerType === 'touch') {
                return [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
              }
              return [new PointerActivationConstraints.Distance({ value: 5 })]
            },
          }),
        ]}
        onDragEnd={(event) => {
          if (event.canceled || busy) return
          const source = event.operation.source
          if (!isSortable(source)) return

          const { initialIndex, index, initialGroup, group: finalGroup } = source
          // Task groups are separate sortable lists; never migrate a task across reset types.
          const taskGroup = GROUPS.find((candidate) => candidate.id === initialGroup)
          if (!taskGroup) return

          const taskIds = active.filter(taskGroup.match).map((task) => task.id)
          const orderedIds = moveTaskWithinGroup(taskIds, initialIndex, index, initialGroup, finalGroup)
          if (!orderedIds || orderedIds.every((id, itemIndex) => id === taskIds[itemIndex])) return
          void persistOrder(orderedIds)
        }}
      >
        <p className="text-xs text-muted">
          Drag a task by its handle to reorder. For keyboard control, focus the handle and press Space, then use the arrow keys.
        </p>
        {GROUPS.map((group) => {
          const tasks = active.filter(group.match)
          if (tasks.length === 0) return null
          return (
            <section key={group.id} className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">{group.label}</h4>
              <ul className="space-y-1.5">
                {tasks.map((task, taskIndex) => {
                  const presetTask = preset?.tasks.find((p) => p.key === task.preset_key)
                  const showTarget = task.weekly_target !== null || targetFor === task.id
                  const canSetTarget =
                    !showTarget && (task.preset_key === null ? task.frequency !== 'none' : Boolean(presetTask?.targetEditable))
                  // With a target box, the name gets its own line on a phone so it isn't squeezed.
                  const extras = showTarget || canSetTarget
                  return (
                    <SortableTaskRow
                      key={task.id}
                      task={task}
                      index={taskIndex}
                      group={group.id}
                      disabled={busy || tasks.length < 2}
                      extras={extras}
                      showTarget={showTarget}
                      canSetTarget={canSetTarget}
                      targetFor={targetFor}
                      onTargetBlur={(targetTask, value) => {
                        setTargetFor(null)
                        if (value !== targetTask.weekly_target) {
                          void run(() => setWeeklyTarget(targetTask.id, value))
                        }
                      }}
                      onSetTarget={setTargetFor}
                      onRemove={handleRemove}
                      onToggleHidden={(targetTask) => void run(() => setTaskHidden(targetTask.id, !targetTask.hidden))}
                    />
                  )
                })}
              </ul>
            </section>
          )
        })}
      </DragDropProvider>
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

      {removedTask && (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
          <span>Removed &quot;{removedTask.title}&quot;.</span>
          <Button size="sm" variant="link" disabled={busy} onClick={handleUndoRemove}>Undo</Button>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}