import { Link } from 'react-router'
import SpendPrompt from '../components/SpendPrompt'
import { Button, Card, CheckIcon, ChevronIcon, Loading, Notice, PageTitle } from '../components/ui'
import { buildToday, clockOf, dailiesLeft, useTodayData } from '../lib/today'
import { dailyPeriod, formatClock, formatDuration, formatWhen } from '../lib/time'
import { useBulkUndo } from '../components/bulkUndo/useBulkUndo'
import { useNow } from '../lib/useNow'
import { overCapBy } from '../lib/stamina'

// Small colour cue per game; the only game-specific colour in the neutral look.
const DOT: Record<string, string> = { genshin: 'bg-game-genshin', wuwa: 'bg-game-wuwa', nte: 'bg-game-nte' }
const dot = (presetId: string) => DOT[presetId] ?? 'bg-muted'

export default function TodayPage() {
  const { data, error, loading, addCompletion, removeCompletions, setMeterValue, setSkipped } = useTodayData()
  const now = useNow()
  const today = data ? buildToday(data, now) : null

  // Bulk undo state lives above the route switch, so it survives navigation between tabs.
  const { batches, begin, complete, dismiss, dismissPrompt } = useBulkUndo()

  const tickAll = async (gameId: string, meterId: string | null) => {
    const game = data?.games.find((g) => g.id === gameId)
    if (!game || !data) return
    const tasks = dailiesLeft(game, data, now)
    if (tasks.length === 0) return
    const operationId = begin(gameId, tasks.length, meterId)
    const start = dailyPeriod(clockOf(game), now).start // these are all plain dailies
    const results = await Promise.all(tasks.map(async (task) => ({
      taskId: task.id,
      completionId: await addCompletion(task.id, start),
    })))
    complete(gameId, operationId, results.filter((entry): entry is { taskId: string; completionId: string } => !!entry.completionId))
  }

  const undoAll = async (gameId: string) => {
    const batch = batches[gameId]
    if (!batch || batch.status !== 'ready') return
    const results = await Promise.all(batch.entries.map((entry) => removeCompletions(entry.taskId, [entry.completionId])))
    if (results.every(Boolean)) dismiss(gameId, batch.operationId)

  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <PageTitle>Today</PageTitle>
          <span className="text-sm text-muted">
            {now.toLocaleDateString([], { weekday: 'long' })} · {formatClock(now)}
          </span>
        </div>
        {today && today.dailyProgress.total > 0 && (
          <section aria-labelledby="overall-daily-progress" className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <h2 id="overall-daily-progress" className="text-muted">Daily progress</h2>
              <span className="font-semibold tabular-nums">
                {today.dailyProgress.done} of {today.dailyProgress.total} done
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Daily progress across all games"
              aria-valuemin={0}
              aria-valuemax={today.dailyProgress.total}
              aria-valuenow={today.dailyProgress.done}
              aria-valuetext={`${today.dailyProgress.done} of ${today.dailyProgress.total} daily tasks done`}
              className="h-2 overflow-hidden rounded-full bg-line"
            >
              <span
                aria-hidden="true"
                className="block h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.round((today.dailyProgress.done / today.dailyProgress.total) * 100)}%` }}
              />
            </div>
          </section>
        )}
      </header>

      {loading && <Loading>Loading your games…</Loading>}
      {error && <Notice tone="error" size="md">{error}</Notice>}

      {today && (
        <>
          <section aria-labelledby="na-h" className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between">
              <h2 id="na-h" className="text-base font-semibold">Needs attention</h2>
              <span className="text-xs text-muted">Next 24 hours</span>
            </div>
            {today.attention.length === 0 ? (
              <Card as="p" padding="md" className="text-sm text-muted">
                Nothing urgent. You're all caught up.
              </Card>
            ) : (
              <Card as="ul" padding="none" className="overflow-hidden">
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
              </Card>
            )}
          </section>

          <section aria-labelledby="g-h" className="flex flex-col gap-2.5">
            <h2 id="g-h" className="text-base font-semibold">Your games</h2>
            {today.cards.length === 0 && (
              <p className="text-muted">
                No games yet. <Link to="/games" className="inline-flex min-h-11 items-center text-accent underline">Add one</Link>.
              </p>
            )}
            <div className="flex flex-wrap gap-4">
              {today.cards.map((card) => {
                const pct = card.dailyTotal ? Math.round((card.dailyDone / card.dailyTotal) * 100) : 0
                const left = card.dailyTotal - card.dailyDone
                const game = data?.games.find((g) => g.id === card.id)
                const toTick = game && data ? dailiesLeft(game, data, now).length : 0
                const mine = batches[card.id] ?? null
                const saving = mine?.status === 'saving'
                return (
                  // NAV-1 / A2: the card body opens the game page (a chevron says so, and it lights up on hover).
                  // The quick "all dailies done" action sits in its own footer, outside the link, so the two never mix.
                  // The focus ring goes round the whole card when the link has keyboard focus.
                  <Card
                    key={card.id}
                    padding="none"
                    className="flex min-w-0 flex-[1_1_300px] flex-col overflow-hidden has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-accent"
                  >
                    <div className="group/open relative flex flex-1 flex-col gap-3 p-4 transition-colors hover:bg-raised">
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className={`size-2.5 rounded-[3px] ${dot(card.presetId)}`} />
                        <Link to={`/game/${card.presetId}`} className="flex-1 font-semibold after:absolute after:inset-0 focus-visible:outline-none">
                          <span className="sr-only">Open </span>
                          {card.name}
                        </Link>
                        <span className="text-xs text-muted">Reset in {formatDuration(card.resetAt.getTime() - now.getTime())}</span>
                        <span aria-hidden="true" className="-mr-1 text-muted transition-[color,translate] group-hover/open:translate-x-0.5 group-hover/open:text-ink">
                          <ChevronIcon size={16} />
                        </span>
                      </span>

                      <span className="flex flex-col gap-1.5">
                        <span className="flex justify-between text-sm">
                          <span className="text-muted">
                            Dailies <span className="font-semibold text-ink">{card.dailyDone} / {card.dailyTotal}</span> done
                          </span>
                          <span className="font-semibold">
                            {card.skipped ? <span className="font-medium text-muted">Resting today</span> : left === 0 ? 'All done' : `${left} left`}
                          </span>
                        </span>
                        <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-line">
                          <span className={`block h-full ${card.skipped ? 'bg-muted/40' : dot(card.presetId)}`} style={{ width: `${pct}%` }} />
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
                            {card.meter.full
                              ? overCapBy(card.meter) > 0 ? `Above cap (+${overCapBy(card.meter)})` : 'Full now'
                              : card.meter.fullAt ? `Full ${formatWhen(card.meter.fullAt, now)}` : ''}
                          </span>
                        </span>
                      )}

                      {card.note && (
                        <span className={`text-xs ${card.note.soon ? 'text-urgent' : 'text-muted'}`}>
                          {card.note.text}
                          {card.note.at ? ` · resets in ${formatDuration(card.note.at.getTime() - now.getTime())}` : ''}
                        </span>
                      )}

                    </div>

                    {/* Quick actions, in a footer of their own outside the link: tapping around them never opens the game.
                        "All dailies done" ticks the rest; "Skip today" rests the game until its reset (TOD-7). */}
                    {(mine || card.skipped || left > 0) && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
                        {mine ? (
                          <Button variant="link" size="sm" onClick={() => void undoAll(card.id)} disabled={saving}>
                            {saving ? 'Saving…' : `Undo (${mine.entries.length})`}
                          </Button>
                        ) : card.skipped ? (
                          <>
                            <span className="text-xs text-muted">Resting until reset · no reminders</span>
                            {game && (
                              <Button variant="link" size="sm" className="ml-auto" onClick={() => void setSkipped(game, false)} aria-label={`Undo skip for ${card.name}`}>
                                Undo skip
                              </Button>
                            )}
                          </>
                        ) : (
                          <>
                            {toTick > 1 && (
                              <Button size="sm" onClick={() => void tickAll(card.id, card.meter?.id ?? null)}>
                                <CheckIcon size={14} />
                                All {toTick} dailies done
                              </Button>
                            )}
                            {game && (
                              <Button variant="quiet" size="sm" className="ml-auto" onClick={() => void setSkipped(game, true)} aria-label={`Skip ${card.name} today`}>
                                Skip today
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {mine?.promptVisible && card.meter && (
                      <div className="border-t border-line">
                        <SpendPrompt
                          meter={card.meter}
                          onSave={(v) => {
                            if (game) void setMeterValue(game, card.meter!.id, v)
                            dismissPrompt(card.id, mine.operationId)
                          }}
                          onSkip={() => dismissPrompt(card.id, mine.operationId)}
                        />
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
