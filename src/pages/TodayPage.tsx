import { Link } from 'react-router'
import SpendPrompt from '../components/SpendPrompt'
import { Button, Card, CheckIcon, Loading, Notice, PageTitle } from '../components/ui'
import { buildToday, clockOf, dailiesLeft, useTodayData } from '../lib/today'
import { dailyPeriod, formatClock, formatDuration } from '../lib/time'
import { useBulkUndo } from '../components/bulkUndo/useBulkUndo'
import { useNow } from '../lib/useNow'
import { TodayCard } from '../components/TodayCard'
import { useGameFonts } from '../lib/gameFonts'
import { useCharacterImages } from '../lib/useCharacterImages'
import { useMedia } from '../lib/useMedia'
import { useDataSaver } from '../lib/dataSaver'
import { useGameIcons } from '../lib/useGameIcons'

// Small colour cue per game; the only game-specific colour in the neutral look.
const DOT: Record<string, string> = { genshin: 'bg-game-genshin', wuwa: 'bg-game-wuwa', nte: 'bg-game-nte' }
const dot = (presetId: string) => DOT[presetId] ?? 'bg-muted'

export default function TodayPage() {
  const { data, error, loading, addCompletion, removeCompletions, setMeterValue, setSkipped } = useTodayData()
  const now = useNow()
  const today = data ? buildToday(data, now) : null
  // LTR-8: your own pictures for the roster cards. Only where a card can be hovered (phones only see them
  // for a moment while pressing) and never with Data saver (THM-7), so those devices download nothing.
  const canHover = useMedia('(hover: hover) and (pointer: fine)')
  const dataSaver = useDataSaver()
  const { images: characterImages } = useCharacterImages(canHover && !dataSaver.on)
  // LTR-8: your game icons (tiny, and they identify the game, so shown everywhere, Data saver included)
  const icons = useGameIcons(data?.games ?? [])
  // THM-8: each game's own numerals when its card wakes; only where cards can be hovered, never with Data saver
  useGameFonts(canHover && !dataSaver.on)

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

  const progress = today?.dailyProgress
  const leftOverall = progress ? progress.total - progress.done : 0
  // The next reset among the games that still have dailies left (resting games left out)
  const nextReset = today?.cards
    .filter((c) => !c.skipped && c.dailyDone < c.dailyTotal)
    .map((c) => c.resetAt)
    .sort((a, b) => a.getTime() - b.getTime())[0]

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <PageTitle>Today</PageTitle>
          <span className="text-sm text-muted">
            {now.toLocaleDateString([], { weekday: 'long' })} · {formatClock(now)}
          </span>
        </div>
        {progress && progress.total > 0 && (
          <section aria-labelledby="overall-daily-progress" className="flex flex-col gap-1">
            <h2 id="overall-daily-progress" className="gc-label">Daily progress</h2>
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <span className="font-display text-3xl leading-none font-bold tabular-nums">
                {progress.done}
                <span className="ml-1.5 font-sans text-sm font-semibold text-muted">of {progress.total} done</span>
              </span>
              <span className="gc-tag">
                {leftOverall === 0 ? 'All done today' : `${leftOverall} left${nextReset ? ` · next reset ${formatDuration(nextReset.getTime() - now.getTime())}` : ''}`}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Daily progress across all games"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              aria-valuetext={`${progress.done} of ${progress.total} daily tasks done`}
              className="gc-slant-bar mt-2"
            >
              <i aria-hidden="true" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
            </div>
          </section>
        )}
      </header>

      {loading && <Loading>Loading your games…</Loading>}
      {error && <Notice tone="error" size="md">{error}</Notice>}

      {today && (
        <div className="flex flex-col gap-6">
          {/* Your games come first on wider screens; on a phone the short attention list comes first */}
          <section aria-labelledby="g-h" className="flex flex-col gap-2.5">
            <h2 id="g-h" className="text-base font-semibold">Your games</h2>
            {today.cards.length === 0 && (
              <p className="text-muted">
                No games yet. <Link to="/games" className="inline-flex min-h-11 items-center text-accent underline">Add one</Link>.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {today.cards.map((card) => {
                const left = card.dailyTotal - card.dailyDone
                const game = data?.games.find((g) => g.id === card.id)
                const toTick = game && data ? dailiesLeft(game, data, now).length : 0
                const mine = batches[card.id] ?? null
                const saving = mine?.status === 'saving'
                // Quick actions sit in the card's footer, outside the link: tapping around them never opens
                // the game. "All dailies done" ticks the rest; "Skip today" rests the game until its reset (TOD-7).
                const footer = mine ? (
                  <Button variant="link" size="sm" onClick={() => void undoAll(card.id)} disabled={saving}>
                    {saving ? 'Saving…' : `Undo (${mine.entries.length})`}
                  </Button>
                ) : card.skipped ? (
                  <>
                    <span className="text-xs text-muted">Resting until reset · no reminders</span>
                    {game && (
                      <Button size="sm" className="gc-main ml-auto" onClick={() => void setSkipped(game, false)} aria-label={`Undo skip for ${card.name}`}>
                        Undo skip
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    {toTick > 1 ? (
                      <Button size="sm" className="gc-main" onClick={() => void tickAll(card.id, card.meter?.id ?? null)}>
                        <CheckIcon size={14} />
                        All {toTick} dailies done
                      </Button>
                    ) : left === 0 && card.dailyTotal > 0 ? (
                      <span className="flex items-center gap-1.5 text-sm text-muted"><CheckIcon size={14} />All dailies done</span>
                    ) : null}
                    {game && left > 0 && (
                      <Button variant="quiet" size="sm" className="ml-auto" onClick={() => void setSkipped(game, true)} aria-label={`Skip ${card.name} today`}>
                        Skip today
                      </Button>
                    )}
                  </>
                )
                const after = mine?.promptVisible && card.meter ? (
                  <SpendPrompt
                    meter={card.meter}
                    onSave={(v) => {
                      if (game) void setMeterValue(game, card.meter!.id, v)
                      dismissPrompt(card.id, mine.operationId)
                    }}
                    onSkip={() => dismissPrompt(card.id, mine.operationId)}
                  />
                ) : null
                return (
                  <TodayCard
                    key={card.id}
                    card={card}
                    now={now}
                    iconUrl={icons[card.id]}
                    images={characterImages[card.id] ?? []}
                    footer={footer}
                    after={after}
                  />
                )
              })}
            </div>
          </section>

          <section aria-labelledby="na-h" className="flex flex-col gap-2.5 max-md:order-first">
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
                        <span className="shrink-0 md:w-24 md:text-right">
                          <span className="gc-tag" data-tone={item.urgent || ms <= 0 ? 'urgent' : undefined}>{formatDuration(ms)}</span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </Card>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
