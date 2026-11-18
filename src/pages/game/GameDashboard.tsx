import { Fragment, useState, type ReactNode } from 'react'
import SpendPrompt from '../../components/SpendPrompt'
import { findPreset, findServer } from '../../data/presets'
import { meterStates } from '../../lib/stamina'
import { dailyPeriod, formatDuration, formatWhen, weeklyPeriod } from '../../lib/time'
import { clockOf, dailiesLeft, isSkippedNow, isVisible, periodCompletionIds, taskProgress, type Task, type TodayData } from '../../lib/today'
import { useBulkUndo } from '../../components/bulkUndo/useBulkUndo'
import { Button, cx } from '../../components/ui'
import { Check, CountedRow, EndDateEditor, MeterCard, TaskRow } from './GameParts'
import { GameIcon } from '../../components/GameIcon'
import { useGameIcons } from '../../lib/useGameIcons'
import { useGameFonts } from '../../lib/gameFonts'
import { useMedia } from '../../lib/useMedia'
import { useDataSaver } from '../../lib/dataSaver'

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
  // THM-11: the game's own numerals on its themed page, on the same terms as Today (mouse devices, not Data saver)
  const canHover = useMedia('(hover: hover) and (pointer: fine)')
  const dataSaver = useDataSaver()
  useGameFonts(canHover && !dataSaver.on)
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

  // THM-9 (step 3): the page in the Today page's voice. A title with the reset times as numbers, then one
  // panel per section with a spaced label; ticks, bars and tags in the game's colour (.gc-set).
  return (
    <section data-game={game.preset_id ?? undefined} aria-labelledby="game-title" className="gc-set gc-theme flex flex-col gap-6">
      {/* THM-11: the game's world behind its page (index.css; only Genshin so far) */}
      <div aria-hidden="true" className="gc-world" />
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2">
        <GameIcon presetId={game.preset_id} url={icons[game.id]} size={52} className="sm:row-span-2" />
        <h1 id="game-title" className="gc-title font-display text-2xl font-bold leading-tight sm:self-end sm:text-3xl">{game.name}</h1>
        <p className="col-span-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 sm:col-span-1 sm:col-start-2 sm:row-start-2 sm:self-start">
          <Stat label="Daily reset" value={formatDuration(day.end!.getTime() - now.getTime())} />
          <Stat label="Weekly" value={formatDuration(week.end!.getTime() - now.getTime())} />
          {serverLabel && <span className="text-xs text-muted">{serverLabel} server</span>}
        </p>
        <span className="col-start-3 row-start-1 flex items-center gap-2 sm:row-span-2">
          {skipped && <span className="gc-tag" data-tone="rest">Resting today</span>}
          {onSetSkipped && (
            <Button variant={skipped ? 'link' : 'quiet'} size="sm" onClick={() => onSetSkipped(!skipped)}>
              {skipped ? 'Undo skip' : 'Skip today'}
            </Button>
          )}
        </span>
        {skipped && (
          <p className="col-span-3 text-xs text-muted">
            Skipped until the next reset: left out of today's progress, and no reminders for this game until then. You can still tick tasks.
          </p>
        )}
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 [grid-template-areas:'stamina'_'checklist'_'side'] md:grid-cols-[minmax(0,1fr)_340px] md:grid-rows-[auto_1fr] md:[grid-template-areas:'checklist_stamina'_'checklist_side']">
        {/* Stamina: values come from the last recorded snapshot, or what you enter */}
        <Panel label="Stamina" className="gc-panel-stamina [grid-area:stamina]">
          <div className="flex flex-col divide-y divide-line">
            {meters.length === 0 && <p className="py-3 text-sm text-muted">This game has no stamina meter.</p>}
            {meters.map((m) => {
              const row = byId.get(m.id)!
              const parent = row.fills_when_full_of ? byId.get(row.fills_when_full_of) : undefined
              const sub = m.full
                ? m.value > m.cap ? 'Above cap · no refill until you spend' : 'Full now'
                : m.fullAt
                  ? `+1 in ${formatDuration(m.nextPointAt!.getTime() - now.getTime())} · full ${formatWhen(m.fullAt, now)}`
                  : `Fills while ${parent?.name ?? 'the main meter'} is full`
              const estimated = !!preset?.meters.find((pm) => pm.key === row.preset_key)?.estimated
              return (
                <div key={m.id} className="py-3.5 first:pt-3 last:pb-4">
                  <MeterCard state={m} row={row} sub={sub} estimated={estimated} onSet={(v) => onSetMeter(m.id, v)} />
                </div>
              )
            })}
          </div>
          {bulk?.promptVisible && bulk.promptMeterId && (() => {
            const meter = meters.find((candidate) => candidate.id === bulk.promptMeterId)
            return meter ? (
              <div className="-mx-4 border-t border-line [&_form]:border-b-0">
                <SpendPrompt
                  meter={meter}
                  onSave={(value) => {
                    onSetMeter(meter.id, value)
                    dismissPrompt(game.id, bulk.operationId)
                  }}
                  onSkip={() => dismissPrompt(game.id, bulk.operationId)}
                />
              </div>
            ) : null
          })()}
        </Panel>

        {/* Daily, Weekly, Monthly */}
        <div className="flex flex-col gap-5 [grid-area:checklist]">
          {groups.map((group) => {
            // Counted the same way as Today: optional tasks are listed but not counted (THM-8)
            const required = group.items.filter((t) => !t.optional)
            const done = required.filter((t) => progressOf(t).doneForNow).length
            const optionalCount = group.items.length - required.length
            // A task that is waiting for its stamina value stays visible until that is answered
            const shown = quick ? group.items.filter((t) => !progressOf(t).doneForNow || t.id === askFor) : group.items
            return (
              <Panel
                key={group.label}
                label={group.label}
                aside={
                  <>
                    {group.label === 'Daily' && bulk && (
                      <Button size="sm" variant="link" onClick={() => void undoAll()} disabled={bulkSaving}>
                        {bulkSaving ? 'Saving…' : `Undo (${bulk.entries.length})`}
                      </Button>
                    )}
                    {group.label === 'Daily' && !bulk && left.length > 1 && (
                      <Button size="sm" variant="secondary" className="gc-btn" onClick={() => void tickAll()}>
                        All done
                      </Button>
                    )}
                    {optionalCount > 0 && <span className="gc-tag" data-tone="rest">{optionalCount} optional</span>}
                    <span className="gc-count font-display text-lg font-semibold leading-none" aria-label={`${done} of ${required.length} done`}>
                      {done}<span className="text-muted">/{required.length}</span>
                    </span>
                  </>
                }
              >
                <div className="flex flex-col [&>*:last-child]:border-b-0">
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
                    <p className="py-3 text-sm text-muted">
                      {group.label === 'Daily' ? 'All dailies done. Nothing left before the reset.' : `All ${group.label.toLowerCase()} tasks done.`}
                    </p>
                  )}
                </div>
              </Panel>
            )
          })}
        </div>

        {/* Endgame, Events, Goals */}
        <div className="flex flex-col gap-5 [grid-area:side]">
          {endgame.length > 0 && (
            <Panel label="Endgame">
              <div className="-mx-4 flex flex-col divide-y divide-line">
                {endgame
                  .filter((t) => !quick || !progressOf(t).done)
                  .map((t) => {
                    const p = progressOf(t)
                    const notStarted = !!p.period && p.period.start > now // e.g. Endstate Matrix opens 7 days into a version
                    const left = p.period?.end ? p.period.end.getTime() - now.getTime() : null
                    const soon = !notStarted && left !== null && left < 3 * 86_400_000 && !p.done
                    return (
                      <div key={t.id} className="gc-end-row flex flex-col">
                        <Button
                          variant="quiet"
                          aria-pressed={p.done}
                          disabled={!p.period || notStarted}
                          onClick={() => toggle(t)}
                          className="flex min-h-12 w-full items-center gap-3 rounded-none py-2.5 text-left disabled:cursor-default"
                          style={{ display: 'flex', justifyContent: 'flex-start', minHeight: 48, paddingInline: 16, borderRadius: 0 }}
                        >
                          <Check done={p.done} />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="gc-end-title text-sm font-medium text-ink">{t.title}</span>
                            <span className={`text-xs ${soon ? 'text-urgent' : 'text-muted'}`}>
                              {!p.period
                                ? 'Dates not set yet'
                                : notStarted
                                  ? `Opens ${formatWhen(p.period.start, now)}`
                                  : p.done ? 'Cleared this cycle' : soon ? 'Not cleared · ending soon' : 'Not cleared'}
                            </span>
                          </span>
                          {(notStarted || left !== null) && (
                            <span className="flex shrink-0 flex-col items-end">
                              <span className="gc-label">{notStarted ? 'Starts in' : 'Resets in'}</span>
                              <span className={`gc-end-time font-display text-base font-semibold leading-tight ${soon ? 'text-urgent' : 'text-ink'}`}>
                                {formatDuration(notStarted ? p.period!.start.getTime() - now.getTime() : left!)}
                              </span>
                            </span>
                          )}
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
            </Panel>
          )}

          <Panel label="Events" aside={events.length > 0 ? <span className="gc-tag" data-tone="rest">{events.length}</span> : undefined}>
            {events.length === 0 ? (
              <p className="py-3 text-sm text-muted">No events added for this game.</p>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {events.map((ev) => {
                  const left = new Date(ev.ends_at).getTime() - now.getTime()
                  return (
                    <div key={ev.id} className="gc-event-row flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">{ev.name}</span>
                      <span className="gc-tag shrink-0" data-tone={left < 86_400_000 ? 'urgent' : undefined}>Ends in {formatDuration(left)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>

          {goals.length > 0 && (
            <Panel label="Goals">
              <div className="flex flex-col [&>*:last-child]:border-b-0">
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
            </Panel>
          )}
        </div>
      </div>
    </section>
  )
}

/** A spaced label with its number, e.g. DAILY RESET 3h 31m. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="gc-label">{label}</span>
      <span className="gc-stat-num font-display text-base font-semibold">{value}</span>
    </span>
  )
}

/** One section of the page: a panel with a spaced label, and its numbers or buttons on the right. */
function Panel({ label, aside, className, children }: { label: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cx('gc-panel overflow-hidden rounded-2xl border border-line bg-surface px-4', className)}>
      <div className="gc-panel-head -mx-4 flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-2">
        <h2 className="gc-label gc-panel-label">{label}</h2>
        {aside && <span className="flex items-center gap-3">{aside}</span>}
      </div>
      {children}
    </section>
  )
}
