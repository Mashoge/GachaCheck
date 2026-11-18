import { Fragment, useState } from 'react'
import SpendPrompt from '../../components/SpendPrompt'
import { findPreset, findServer } from '../../data/presets'
import { meterStates } from '../../lib/stamina'
import { dailyPeriod, formatDuration, formatWhen, weeklyPeriod } from '../../lib/time'
import { clockOf, dailiesLeft, isSkippedNow, isVisible, periodCompletionIds, taskProgress, type Task, type TodayData } from '../../lib/today'
import { useBulkUndo } from '../../components/bulkUndo/useBulkUndo'
import { Button, Card, Tag } from '../../components/ui'
import { Check, CountedRow, EndDateEditor, MeterCard, TaskRow } from './GameParts'
import { GameIcon } from '../../components/GameIcon'
import { useGameIcons } from '../../lib/useGameIcons'

type Props = {
  game: TodayData['games'][number]
  data: TodayData
  now: Date
  quick: boolean
  onTick: (task: Task, periodStart: Date) => Promise<string | null>
  onRemove: (task: Task, ids: string[]) => Promise<boolean>
  onSetMeter: (meterId: string, value: number) => void
  onSetEndDate: (task: Task, endsAt: string, startDay: string | null, cycleOver: boolean) => void
  /** TOD-7: rest this game until its next daily reset (true), or bring it back (false) */
  onSetSkipped?: (skip: boolean) => void
}

export default function GameDashboard({ game, data, now, quick, onTick, onRemove, onSetMeter, onSetEndDate, onSetSkipped }: Props) {
  const icons = useGameIcons([game]) // LTR-8
  const skipped = isSkippedNow(game, now)
  const clock = clockOf(game)
  const preset = game.preset_id ? findPreset(game.preset_id) : undefined
  const serverLabel = preset && game.server ? findServer(preset, game.server)?.label : null
  const day = dailyPeriod(clock, now)
  const week = weeklyPeriod(clock, now)
  const tasks = game.tasks.filter(isVisible)
  const meters = meterStates(game.stamina_meters, now)
  const byId = new Map(game.stamina_meters.map((m) => [m.id, m]))

  const groups = [
    { label: 'Daily', items: tasks.filter((t) => t.category !== 'endgame' && t.frequency === 'daily') },
    { label: 'Weekly', items: tasks.filter((t) => t.category !== 'endgame' && t.frequency === 'weekly') },
    { label: 'Monthly', items: tasks.filter((t) => t.category !== 'endgame' && t.frequency === 'monthly') },
  ].filter((g) => g.items.length > 0)
  const endgame = tasks.filter((t) => t.category === 'endgame')
  const goals = tasks.filter((t) => t.category === 'goal' || t.frequency === 'none')
  const events = data.events.filter((e) => e.game_id === game.id)

  const progressOf = (t: Task) => taskProgress(t, data, clock, now)
  const completionIds = (t: Task) => periodCompletionIds(t, data, clock, now)

  // A "Spend …" task is linked to a stamina meter in the preset. Ticking it asks what the meter shows now,
  // so reminders keep working from a real value.
  const [askFor, setAskFor] = useState<string | null>(null) // id of the task whose meter we're asking about
  const meterFor = (t: Task) => {
    const key = preset?.tasks.find((pt) => pt.key === t.preset_key)?.meter
    const row = key ? game.stamina_meters.find((m) => m.preset_key === key) : undefined
    return row ? meters.find((m) => m.id === row.id) : undefined
  }

  // The shared undo record survives route changes and contains only rows created by this bulk action.
  const { batches, begin, complete, dismiss, dismissPrompt } = useBulkUndo()
  const bulk = batches[game.id] ?? null
  const left = dailiesLeft(game, data, now)
  const tickAll = async () => {
    if (left.length === 0) return
    const spend = left.find((task) => meterFor(task))
    const promptMeterId = spend ? meterFor(spend)?.id ?? null : null
    const operationId = begin(game.id, left.length, promptMeterId)
    const results = await Promise.all(left.map(async (task) => ({
      taskId: task.id,
      completionId: await onTick(task, progressOf(task).period!.start),
    })))
    complete(game.id, operationId, results.filter((entry): entry is { taskId: string; completionId: string } => !!entry.completionId))
  }
  const bulkSaving = bulk?.status === 'saving'
  const undoAll = async () => {
    if (!bulk || bulk.status !== 'ready') return
    const results = await Promise.all(bulk.entries.map((entry) => {
      const task = game.tasks.find((candidate) => candidate.id === entry.taskId)
      return task ? onRemove(task, [entry.completionId]) : Promise.resolve(true)
    }))
    if (results.every(Boolean)) {
      dismiss(game.id, bulk.operationId)
      setAskFor(null)
    }
  }

  const toggle = (t: Task) => {
    const p = progressOf(t)
    if (!p.period) return
    if (p.done) {
      void onRemove(t, completionIds(t))
      if (askFor === t.id) setAskFor(null)
    } else {
      onTick(t, p.period.start)
      if (meterFor(t)) setAskFor(t.id)
    }
  }

  return (
    <Card as="section">
      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <GameIcon presetId={game.preset_id} url={icons[game.id]} size={36} />
          <h1 className="font-display text-2xl font-bold">{game.name}</h1>
          {skipped && <Tag>Resting today</Tag>}
          {onSetSkipped && (
            <Button variant={skipped ? 'link' : 'quiet'} size="sm" className="ml-auto" onClick={() => onSetSkipped(!skipped)}>
              {skipped ? 'Undo skip' : 'Skip today'}
            </Button>
          )}
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span>Daily reset in <b className="font-semibold text-ink">{formatDuration(day.end!.getTime() - now.getTime())}</b></span>
          <span>Weekly in <b className="font-semibold text-ink">{formatDuration(week.end!.getTime() - now.getTime())}</b></span>
          {serverLabel && <span>{serverLabel} server</span>}
        </p>
        {skipped && (
          <p className="text-xs text-muted">
            Skipped until the next reset: left out of today's progress, and no reminders for this game until then. You can still tick tasks.
          </p>
        )}
      </header>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-6 [grid-template-areas:'stamina'_'checklist'_'side'] md:grid-cols-[minmax(0,1fr)_340px] md:grid-rows-[auto_1fr] md:[grid-template-areas:'checklist_stamina'_'checklist_side']">
        {/* Stamina: values come from the last recorded snapshot; entering your real value arrives in step 4 */}
        <div className="flex flex-col gap-4 rounded-xl bg-raised p-4 [grid-area:stamina]">
          <h2 className="text-sm font-semibold">Stamina</h2>
          {meters.length === 0 && <p className="text-sm text-muted">This game has no stamina meter.</p>}
          {meters.map((m) => {
            const row = byId.get(m.id)!
            const parent = row.fills_when_full_of ? byId.get(row.fills_when_full_of) : undefined
            const sub = m.full
              ? m.value > m.cap ? 'Above cap · no refill until you spend' : 'Full now'
              : m.fullAt
                ? `+1 in ${formatDuration(m.nextPointAt!.getTime() - now.getTime())} · full ${formatWhen(m.fullAt, now)}`
                : `Fills while ${parent?.name ?? 'the main meter'} is full`
            const estimated = !!preset?.meters.find((pm) => pm.key === row.preset_key)?.estimated
            return <MeterCard key={m.id} state={m} row={row} sub={sub} estimated={estimated} onSet={(v) => onSetMeter(m.id, v)} />
          })}
          {bulk?.promptVisible && bulk.promptMeterId && (() => {
            const meter = meters.find((candidate) => candidate.id === bulk.promptMeterId)
            return meter ? (
              <SpendPrompt
                meter={meter}
                onSave={(value) => {
                  onSetMeter(meter.id, value)
                  dismissPrompt(game.id, bulk.operationId)
                }}
                onSkip={() => dismissPrompt(game.id, bulk.operationId)}
              />
            ) : null
          })()}
        </div>

        {/* Daily, Weekly, Monthly */}
        <div className="flex flex-col gap-6 [grid-area:checklist]">
          {groups.map((group) => {
            // Counted the same way as Today: optional tasks are listed but not counted (THM-8)
            const required = group.items.filter((t) => !t.optional)
            const done = required.filter((t) => progressOf(t).doneForNow).length
            const optionalCount = group.items.length - required.length
            // A task that is waiting for its stamina value stays visible until that is answered
            const shown = quick ? group.items.filter((t) => !progressOf(t).doneForNow || t.id === askFor) : group.items
            return (
              <div key={group.label} className="flex flex-col">
                <div className="flex min-h-9 items-center justify-between gap-3 pb-1">
                  <h2 className="text-sm font-semibold">{group.label}</h2>
                  <span className="flex items-center gap-3 text-xs text-muted">
                    {group.label === 'Daily' && bulk && (
                      <Button size="sm" variant="link" onClick={() => void undoAll()} disabled={bulkSaving}>
                        {bulkSaving ? 'Saving…' : `Undo (${bulk.entries.length})`}
                      </Button>
                    )}
                    {group.label === 'Daily' && !bulk && left.length > 1 && (
                      <Button size="sm" variant="secondary" onClick={() => void tickAll()}>
                        All done
                      </Button>
                    )}
                    {done} / {required.length} done{optionalCount > 0 && ` · ${optionalCount} optional`}
                  </span>
                </div>
                {shown.map((t) =>
                  t.weekly_target ? (
                    <CountedRow key={t.id} task={t} progress={progressOf(t)} onAdd={() => onTick(t, progressOf(t).period!.start)} onUndo={() => onRemove(t, completionIds(t).slice(-1))} />
                  ) : (
                    <Fragment key={t.id}>
                      <TaskRow task={t} done={progressOf(t).done} onToggle={() => toggle(t)} />
                      {askFor === t.id && meterFor(t) && (
                        <SpendPrompt
                          meter={meterFor(t)!}
                          onSave={(v) => {
                            onSetMeter(meterFor(t)!.id, v)
                            setAskFor(null)
                          }}
                          onSkip={() => setAskFor(null)}
                        />
                      )}
                    </Fragment>
                  ),
                )}
                {shown.length === 0 && (
                  <p className="py-2 text-sm text-muted">
                    {group.label === 'Daily' ? 'All dailies done. Nothing left before the reset.' : `All ${group.label.toLowerCase()} tasks done.`}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {/* Endgame, Events, Goals */}
        <div className="flex flex-col gap-6 [grid-area:side]">
          {endgame.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">Endgame</h2>
              {endgame
                .filter((t) => !quick || !progressOf(t).done)
                .map((t) => {
                  const p = progressOf(t)
                  const notStarted = !!p.period && p.period.start > now // e.g. Endstate Matrix opens 7 days into a version
                  const left = p.period?.end ? p.period.end.getTime() - now.getTime() : null
                  const soon = !notStarted && left !== null && left < 3 * 86_400_000 && !p.done
                  return (
                    <div key={t.id} className={`flex flex-col rounded-xl border bg-raised ${soon ? 'border-urgent' : 'border-transparent'}`}>
                      <Button
                        variant="quiet"
                        aria-pressed={p.done}
                        disabled={!p.period || notStarted}
                        onClick={() => toggle(t)}
                        className="flex min-h-12 w-full items-center gap-3 rounded-none py-2 text-left disabled:cursor-default"
                        style={{ display: 'flex', justifyContent: 'flex-start', minHeight: 48, paddingInline: 12, borderRadius: 0 }}
                      >
                        <Check done={p.done} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-sm font-medium">{t.title}</span>
                          <span className={`text-xs ${soon ? 'text-urgent' : 'text-muted'}`}>
                            {!p.period
                              ? 'Dates not set yet'
                              : notStarted
                                ? `Opens ${formatWhen(p.period.start, now)}`
                                : p.done ? 'Cleared this cycle' : soon ? 'Not cleared · ending soon' : 'Not cleared'}
                          </span>
                        </span>
                        <span className={`whitespace-nowrap text-xs font-semibold ${soon ? 'text-urgent' : ''}`}>
                          {notStarted
                            ? `Starts in ${formatDuration(p.period!.start.getTime() - now.getTime())}`
                            : left !== null ? `Resets in ${formatDuration(left)}` : '—'}
                        </span>
                      </Button>
                      {/* Modes without a fixed schedule: you enter when the current cycle ends */}
                      {t.frequency === 'dated' && (
                        <EndDateEditor
                          task={t}
                          active={!!p.period}
                          timezone={game.timezone}
                          zoneLabel={serverLabel ?? 'game'}
                          now={now}
                          onSave={(endsAt, startDay) => onSetEndDate(t, endsAt, startDay, !p.period)}
                        />
                      )}
                    </div>
                  )
                })}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Events</h2>
            {events.length === 0 ? (
              <p className="text-sm text-muted">No events added for this game.</p>
            ) : (
              events.map((ev) => {
                const left = new Date(ev.ends_at).getTime() - now.getTime()
                return (
                  <div key={ev.id} className="flex min-h-10 items-center justify-between gap-3 border-b border-line py-1.5 text-sm">
                    <span className="min-w-0">{ev.name}</span>
                    <span className={`shrink-0 whitespace-nowrap text-xs font-semibold ${left < 86_400_000 ? 'text-urgent' : 'text-muted'}`}>Ends in {formatDuration(left)}</span>
                  </div>
                )
              })
            )}
          </div>

          {goals.length > 0 && (
            <div className="flex flex-col">
              <h2 className="pb-1 text-sm font-semibold">Goals</h2>
              {goals
                .filter((t) => !quick || !progressOf(t).done)
                .map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    done={progressOf(t).done}
                    onToggle={() => toggle(t)}
                    meta={t.due_at ? `Due ${formatWhen(new Date(t.due_at), now)}` : undefined}
                  />
                ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

