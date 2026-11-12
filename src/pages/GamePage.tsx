import { Fragment, useState } from 'react'
import { Link, NavLink, useParams } from 'react-router'
import { findPreset, findServer } from '../data/presets'
import { meterStates, type MeterRow, type MeterState } from '../lib/stamina'
import { dailyPeriod, formatDuration, formatWhen, weeklyPeriod } from '../lib/time'
import { clockOf, isVisible, taskProgress, useTodayData, type Task, type TodayData } from '../lib/today'
import { SHORT_NAMES } from '../lib/useGames'
import { useNow } from '../lib/useNow'

// Phone opens on "What's left", PC on "Everything"
const startsQuick = () => typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches

export default function GamePage() {
  const { presetId } = useParams()
  const { data, error, loading, addCompletion, removeCompletions, setMeterValue } = useTodayData()
  const now = useNow()
  const [quick, setQuick] = useState(startsQuick)

  const games = data?.games ?? []
  const game = games.find((g) => g.preset_id === presetId)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {games.length > 1 && (
          <div role="group" aria-label="Game" className="flex w-full gap-1 rounded-xl border border-line bg-surface p-1 md:w-fit">
            {games.map((g) => (
              <NavLink
                key={g.id}
                to={`/game/${g.preset_id}`}
                className={({ isActive }) =>
                  `flex min-h-10 flex-1 items-center justify-center rounded-lg px-4 text-sm font-semibold ${
                    isActive ? 'bg-accent text-on-accent' : 'text-muted hover:text-ink'
                  }`
                }
              >
                {SHORT_NAMES[g.preset_id ?? ''] ?? g.name}
              </NavLink>
            ))}
          </div>
        )}
        <div role="group" aria-label="Show" className="ml-auto flex gap-0.5 rounded-full border border-line bg-surface p-1">
          {[
            { label: "What's left", on: quick, set: true },
            { label: 'Everything', on: !quick, set: false },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              aria-pressed={b.on}
              onClick={() => setQuick(b.set)}
              className={`min-h-9 rounded-full px-4 text-sm font-semibold ${b.on ? 'bg-accent text-on-accent' : 'text-muted hover:text-ink'}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-muted">Loading…</p>}
      {error && <p className="text-urgent">{error}</p>}
      {data && !game && (
        <p className="text-muted">
          This game isn't in your list. <Link to="/games" className="text-accent underline">Manage games</Link>
        </p>
      )}

      {data && game && (
        <GameDashboard
          game={game}
          data={data}
          now={now}
          quick={quick}
          onTick={(task, periodStart) => void addCompletion(task.id, periodStart)}
          onRemove={(task, ids) => void removeCompletions(task.id, ids)}
          onSetMeter={(meterId, value) => void setMeterValue(game, meterId, value)}
        />
      )}
    </div>
  )
}

type Props = {
  game: TodayData['games'][number]
  data: TodayData
  now: Date
  quick: boolean
  onTick: (task: Task, periodStart: Date) => void
  onRemove: (task: Task, ids: string[]) => void
  onSetMeter: (meterId: string, value: number) => void
}

function GameDashboard({ game, data, now, quick, onTick, onRemove, onSetMeter }: Props) {
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
  const completionIds = (t: Task) => {
    const p = progressOf(t).period
    if (!p) return []
    const start = p.start.getTime()
    const end = p.end ? p.end.getTime() : Infinity
    return (data.completions.get(t.id) ?? []).filter((c) => {
      const at = new Date(c.at).getTime()
      return at >= start && at < end
    }).map((c) => c.id)
  }

  // A "Spend …" task is linked to a stamina meter in the preset. Ticking it asks what the meter shows now,
  // so reminders keep working from a real value.
  const [askFor, setAskFor] = useState<string | null>(null) // id of the task whose meter we're asking about
  const meterFor = (t: Task) => {
    const key = preset?.tasks.find((pt) => pt.key === t.preset_key)?.meter
    const row = key ? game.stamina_meters.find((m) => m.preset_key === key) : undefined
    return row ? meters.find((m) => m.id === row.id) : undefined
  }

  const toggle = (t: Task) => {
    const p = progressOf(t)
    if (!p.period) return
    if (p.done) {
      onRemove(t, completionIds(t))
      if (askFor === t.id) setAskFor(null)
    } else {
      onTick(t, p.period.start)
      if (meterFor(t)) setAskFor(t.id)
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-bold">{game.name}</h1>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span>Daily reset in <b className="font-semibold text-ink">{formatDuration(day.end!.getTime() - now.getTime())}</b></span>
          <span>Weekly in <b className="font-semibold text-ink">{formatDuration(week.end!.getTime() - now.getTime())}</b></span>
          {serverLabel && <span>{serverLabel} server</span>}
        </p>
      </header>

      <div className="mt-5 grid gap-6 [grid-template-areas:'stamina'_'checklist'_'side'] md:grid-cols-[minmax(0,1fr)_340px] md:grid-rows-[auto_1fr] md:[grid-template-areas:'checklist_stamina'_'checklist_side']">
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
        </div>

        {/* Daily, Weekly, Monthly */}
        <div className="flex flex-col gap-6 [grid-area:checklist]">
          {groups.map((group) => {
            const done = group.items.filter((t) => progressOf(t).doneForNow).length
            // A task that is waiting for its stamina value stays visible until that is answered
            const shown = quick ? group.items.filter((t) => !progressOf(t).doneForNow || t.id === askFor) : group.items
            return (
              <div key={group.label} className="flex flex-col">
                <div className="flex items-center justify-between pb-1">
                  <h2 className="text-sm font-semibold">{group.label}</h2>
                  <span className="text-xs text-muted">{done} / {group.items.length} done</span>
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
                  const left = p.period?.end ? p.period.end.getTime() - now.getTime() : null
                  const soon = left !== null && left < 3 * 86_400_000 && !p.done
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={p.done}
                      disabled={!p.period}
                      onClick={() => toggle(t)}
                      className={`flex min-h-12 items-center gap-3 rounded-xl border bg-raised px-3 py-2 text-left disabled:cursor-default ${soon ? 'border-urgent' : 'border-transparent'}`}
                    >
                      <Check done={p.done} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm font-medium">{t.title}</span>
                        <span className={`text-xs ${soon ? 'text-urgent' : 'text-muted'}`}>
                          {!p.period ? 'Dates not set yet' : p.done ? 'Cleared this cycle' : soon ? 'Not cleared · ending soon' : 'Not cleared'}
                        </span>
                      </span>
                      <span className={`whitespace-nowrap text-xs font-semibold ${soon ? 'text-urgent' : ''}`}>
                        {left !== null ? `Resets in ${formatDuration(left)}` : '—'}
                      </span>
                    </button>
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
                  <div key={ev.id} className="flex min-h-10 items-center justify-between gap-3 border-b border-line text-sm">
                    <span>{ev.name}</span>
                    <span className={`text-xs font-semibold ${left < 86_400_000 ? 'text-urgent' : 'text-muted'}`}>Ends in {formatDuration(left)}</span>
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
    </section>
  )
}

function Check({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-5 shrink-0 items-center justify-center rounded-md ${done ? 'bg-accent' : 'border-[1.5px] border-accent'}`}
    >
      {done && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" className="text-on-accent">
          <path d="M5 12l5 5L20 7" />
        </svg>
      )}
    </span>
  )
}

function TaskRow({ task, done, onToggle, meta }: { task: Task; done: boolean; onToggle: () => void; meta?: string }) {
  return (
    <button
      type="button"
      aria-pressed={done}
      onClick={onToggle}
      className="flex min-h-12 w-full items-center gap-3 border-b border-line py-2 text-left"
    >
      <Check done={done} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex flex-wrap items-center gap-2">
          <span className={`text-sm ${done ? 'text-muted line-through' : ''}`}>{task.title}</span>
          {task.optional && <span className="rounded-full border border-line px-1.5 text-[10px] text-muted">Optional</span>}
        </span>
        {task.note && !done && <span className="text-xs text-muted">{task.note}</span>}
      </span>
      {meta && <span className="whitespace-nowrap text-xs text-muted">{meta}</span>}
    </button>
  )
}

// Shown under a "Spend …" task right after it is ticked.
function SpendPrompt({ meter, onSave, onSkip }: { meter: MeterState; onSave: (value: number) => void; onSkip: () => void }) {
  const [draft, setDraft] = useState('')
  const id = `spent-${meter.id}`
  const value = Number(draft)
  const valid = draft.trim() !== '' && Number.isFinite(value) && value >= 0

  return (
    <form
      className="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onSave(value)
      }}
    >
      <label htmlFor={id} className="w-full text-xs text-muted">
        How much {meter.name} do you have now? This keeps the countdown and reminders right.
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={`0–${meter.cap}`}
        className="min-h-10 w-28 rounded-lg border border-line bg-page px-3 text-sm text-ink placeholder:text-muted"
      />
      <button type="submit" disabled={!valid} className="min-h-10 rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent disabled:opacity-40">Save</button>
      <button type="button" onClick={() => onSave(0)} className="min-h-10 rounded-lg border border-line px-3 text-sm font-semibold text-muted hover:text-ink">None left</button>
      <button type="button" onClick={onSkip} className="min-h-10 rounded-lg px-2 text-sm text-muted hover:text-ink">Skip</button>
    </form>
  )
}

function CountedRow({ task, progress, onAdd, onUndo }: { task: Task; progress: { count: number; target: number; done: boolean; today: boolean; doneForNow: boolean }; onAdd: () => void; onUndo: () => void }) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-b border-line py-2">
      <Check done={progress.doneForNow} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`text-sm ${progress.doneForNow ? 'text-muted' : ''}`}>
          {task.title}
          {progress.today && !progress.done && <span className="ml-2 text-xs">· done today</span>}
        </span>
        {task.note && !progress.done && <span className="text-xs text-muted">{task.note}</span>}
        <span aria-hidden="true" className="block h-1 max-w-48 overflow-hidden rounded-full bg-line">
          <span className="block h-full bg-accent" style={{ width: `${Math.min(100, (progress.count / progress.target) * 100)}%` }} />
        </span>
      </span>
      <span className="text-xs font-semibold text-muted">{progress.count} / {progress.target}</span>
      <button
        type="button"
        onClick={onUndo}
        disabled={progress.count === 0}
        aria-label={`Remove one from ${task.title}`}
        className="flex size-9 items-center justify-center rounded-lg border border-line text-muted disabled:opacity-40"
      >
        −
      </button>
      <button
        type="button"
        onClick={onAdd}
        disabled={progress.done || progress.today}
        aria-label={`Add one to ${task.title}`}
        className="flex size-9 items-center justify-center rounded-lg border border-line text-ink disabled:opacity-40"
      >
        +
      </button>
    </div>
  )
}

function MeterCard({ state, row, sub, estimated, onSet }: { state: MeterState; row: MeterRow & { preset_key?: string | null }; sub: string; estimated: boolean; onSet: (value: number) => void }) {
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-muted">
          {state.name}
          {estimated && <span className="rounded-full border border-line px-1.5 text-[10px]">estimated</span>}
        </span>
        <span className={`font-display text-xl font-semibold ${state.full ? 'text-urgent' : ''}`}>
          {state.value}
          <span className="font-sans text-sm font-normal text-muted"> / {state.cap}</span>
        </span>
      </div>
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-line">
        <div className={`h-full ${state.full ? 'bg-urgent' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
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
          <input
            id={`meter-${row.id}`}
            type="number"
            inputMode="numeric"
            min={0}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`What the game shows (0–${state.cap})`}
            className="min-h-10 min-w-0 flex-1 rounded-lg border border-line bg-page px-3 text-sm text-ink placeholder:text-muted"
          />
          <button type="submit" className="min-h-10 rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="min-h-10 rounded-lg px-2 text-sm text-muted hover:text-ink">Cancel</button>
        </form>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {!state.isOverflow &&
            spends.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onSet(Math.max(0, state.value - n))}
                aria-label={`Spent ${n} ${state.name}`}
                className="min-h-9 rounded-lg border border-line px-2.5 text-xs font-semibold text-muted hover:text-ink"
              >
                −{n}
              </button>
            ))}
          <button
            type="button"
            onClick={() => {
              setDraft(String(state.value))
              setEditing(true)
            }}
            className="min-h-9 rounded-lg border border-line px-2.5 text-xs font-semibold text-muted hover:text-ink"
          >
            Set value
          </button>
        </div>
      )}
    </div>
  )
}