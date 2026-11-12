import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import SpendPrompt from '../components/SpendPrompt'
import { buildToday, clockOf, dailiesLeft, periodCompletionIds, useTodayData, type Task } from '../lib/today'
import { dailyPeriod, formatClock, formatDuration, formatWhen } from '../lib/time'
import { useNow } from '../lib/useNow'

// Small colour cue per game; the only game-specific colour in the neutral look.
const DOT: Record<string, string> = { genshin: 'bg-game-genshin', wuwa: 'bg-game-wuwa', nte: 'bg-game-nte' }
const dot = (presetId: string) => DOT[presetId] ?? 'bg-muted'

export default function TodayPage() {
  const { data, error, loading, addCompletion, removeCompletions, setMeterValue } = useTodayData()
  const now = useNow()
  const today = data ? buildToday(data, now) : null

  // "All done" on a card: ticks the game's dailies left, then asks for the stamina value once.
  // Undo is offered for a minute.
  const [bulk, setBulk] = useState<{ gameId: string; tasks: Task[]; ask: boolean } | null>(null)
  useEffect(() => {
    if (!bulk) return
    const id = setTimeout(() => setBulk(null), 60_000)
    return () => clearTimeout(id)
  }, [bulk])

  const tickAll = (gameId: string, hasMeter: boolean) => {
    const game = data?.games.find((g) => g.id === gameId)
    if (!game || !data) return
    const tasks = dailiesLeft(game, data, now)
    const start = dailyPeriod(clockOf(game), now).start // these are all plain dailies
    for (const t of tasks) void addCompletion(t.id, start)
    setBulk({ gameId, tasks, ask: hasMeter })
  }
  const idsFor = (t: Task, gameId: string) => {
    const game = data?.games.find((g) => g.id === gameId)
    return game && data ? periodCompletionIds(t, data, clockOf(game), now) : []
  }
  const undoAll = () => {
    if (!bulk) return
    for (const t of bulk.tasks) void removeCompletions(t.id, idsFor(t, bulk.gameId))
    setBulk(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-3xl font-bold">Today</h1>
        <span className="text-sm text-muted">
          {now.toLocaleDateString([], { weekday: 'long' })} · {formatClock(now)}
        </span>
      </div>

      {loading && <p className="text-muted">Loading your games…</p>}
      {error && <p className="text-urgent">{error}</p>}

      {today && (
        <>
          <section aria-labelledby="na-h" className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between">
              <h2 id="na-h" className="text-base font-semibold">Needs attention</h2>
              <span className="text-xs text-muted">Next 24 hours</span>
            </div>
            {today.attention.length === 0 ? (
              <p className="rounded-2xl border border-line bg-surface px-4 py-4 text-sm text-muted">
                Nothing urgent. You're all caught up.
              </p>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
                {today.attention.map((item, i) => {
                  const ms = item.at.getTime() - now.getTime()
                  return (
                    <li key={item.key} className={i > 0 ? 'border-t border-line' : ''}>
                      <Link to={`/game/${item.presetId}`} className="flex min-h-13 items-center gap-3 px-4 py-2 hover:bg-raised">
                        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot(item.presetId)}`} />
                        <span className="flex min-w-0 flex-1 flex-col md:flex-row md:items-center md:gap-4">
                          <span className="text-sm font-medium">{item.title}</span>
                          <span className="text-xs text-muted md:ml-auto md:w-48 md:text-sm">{item.gameName}</span>
                        </span>
                        <span className={`shrink-0 text-right text-sm font-semibold md:w-20 ${item.urgent || ms <= 0 ? 'text-urgent' : ''}`}>
                          {formatDuration(ms)}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="g-h" className="flex flex-col gap-2.5">
            <h2 id="g-h" className="text-base font-semibold">Your games</h2>
            {today.cards.length === 0 && (
              <p className="text-muted">
                No games yet. <Link to="/games" className="text-accent underline">Add one</Link>.
              </p>
            )}
            <div className="flex flex-wrap gap-4">
              {today.cards.map((card) => {
                const pct = card.dailyTotal ? Math.round((card.dailyDone / card.dailyTotal) * 100) : 0
                const left = card.dailyTotal - card.dailyDone
                const game = data?.games.find((g) => g.id === card.id)
                const toTick = game && data ? dailiesLeft(game, data, now).length : 0
                const mine = bulk?.gameId === card.id ? bulk : null
                const saving = !!mine && mine.tasks.some((t) => idsFor(t, card.id).some((id) => id.startsWith('temp-')))
                return (
                  // The whole card opens the game page; the buttons inside sit above that link
                  <div
                    key={card.id}
                    className="relative flex min-w-0 flex-[1_1_300px] flex-col gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-muted"
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className={`size-2.5 rounded-[3px] ${dot(card.presetId)}`} />
                      <Link to={`/game/${card.presetId}`} className="flex-1 font-semibold after:absolute after:inset-0 after:rounded-2xl">
                        {card.name}
                      </Link>
                      <span className="text-xs text-muted">Reset in {formatDuration(card.resetAt.getTime() - now.getTime())}</span>
                    </span>

                    <span className="flex flex-col gap-1.5">
                      <span className="flex justify-between text-sm">
                        <span className="text-muted">
                          Dailies <span className="font-semibold text-ink">{card.dailyDone} / {card.dailyTotal}</span> done
                        </span>
                        <span className="font-semibold">{left === 0 ? 'All done' : `${left} left`}</span>
                      </span>
                      <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-line">
                        <span className={`block h-full ${dot(card.presetId)}`} style={{ width: `${pct}%` }} />
                      </span>
                    </span>

                    {card.meter && (
                      <span className="flex flex-col gap-0.5 text-sm">
                        <span className="flex justify-between gap-3">
                          <span className="text-muted">{card.meter.name}</span>
                          <span className={`whitespace-nowrap font-semibold ${card.meter.full ? 'text-urgent' : ''}`}>
                            {card.meter.value} / {card.meter.cap}
                          </span>
                        </span>
                        <span className={`text-right text-xs ${card.meter.full ? 'text-urgent' : 'text-muted'}`}>
                          {card.meter.full ? 'Full now' : card.meter.fullAt ? `Full ${formatWhen(card.meter.fullAt, now)}` : ''}
                        </span>
                      </span>
                    )}

                    {card.note && (
                      <span className={`text-xs ${card.note.soon ? 'text-urgent' : 'text-muted'}`}>
                        {card.note.text}
                        {card.note.at ? ` · resets in ${formatDuration(card.note.at.getTime() - now.getTime())}` : ''}
                      </span>
                    )}

                    {/* One tap for a quick session: tick the rest, then say how much stamina is left */}
                    {(toTick > 1 || mine) && (
                      <div className="relative z-10 flex items-center gap-2">
                        {mine ? (
                          <button type="button" onClick={undoAll} disabled={saving} className="min-h-9 rounded-lg px-1 text-xs font-semibold text-accent hover:underline disabled:opacity-50">
                            {saving ? 'Saving…' : `Undo (${mine.tasks.length})`}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => tickAll(card.id, !!card.meter)}
                            className="min-h-9 rounded-lg border border-line px-3 text-xs font-semibold text-muted hover:text-ink"
                          >
                            All {toTick} dailies done
                          </button>
                        )}
                      </div>
                    )}
                    {mine?.ask && card.meter && (
                      <div className="relative z-10 -mx-4 -mb-4 overflow-hidden rounded-b-2xl">
                        <SpendPrompt
                          meter={card.meter}
                          onSave={(v) => {
                            if (game) void setMeterValue(game, card.meter!.id, v)
                            setBulk({ ...mine, ask: false })
                          }}
                          onSkip={() => setBulk({ ...mine, ask: false })}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
