import type { ReactNode } from 'react'
import type { GameEvent } from '../../lib/events'
import { formatDuration, formatWhen, taskPeriod } from '../../lib/time'
import { clockOf, isVisible, type Game } from '../../lib/today'
import { PHONE, useMedia } from '../../lib/useMedia'
import { SHORT_NAMES } from '../../lib/useGames'

const DAY = 86_400_000
const SOON_MS = 3 * DAY
const GAME_BG: Record<string, string> = { genshin: 'bg-game-genshin', wuwa: 'bg-game-wuwa', nte: 'bg-game-nte' }
const gameBg = (game: Game | undefined) => GAME_BG[game?.preset_id ?? ''] ?? 'bg-accent'
const shortName = (game: Game | undefined) => (game ? (SHORT_NAMES[game.preset_id ?? ''] ?? game.name) : 'Unknown game')

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  )
}

export function EventCard({ event, game, now, onEdit, onDone }: { event: GameEvent; game: Game | undefined; now: Date; onEdit: () => void; onDone: (done: boolean) => void }) {
  const start = event.starts_at ? new Date(event.starts_at) : null
  const end = new Date(event.ends_at)
  const isDone = !!event.completed_at
  const upcoming = !!start && start > now
  const left = end.getTime() - now.getTime()
  const urgent = !isDone && !upcoming && left <= SOON_MS
  // How much of the event has passed (only when its start is known)
  const passed = start && !upcoming ? Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100)) : null

  return (
    <article className={`flex flex-col gap-2 rounded-2xl border bg-surface p-4 ${urgent ? 'border-urgent' : 'border-line'}`}>
      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className={`size-2.5 rounded-sm ${gameBg(game)}`} />
          {shortName(game)}
          {event.kind === 'web_event' && <span className="rounded-full border border-line px-1.5 text-[10px]">Web event</span>}
          {event.source !== 'manual' && <span className="rounded-full border border-line px-1.5 text-[10px]">{event.origin === 'catalog' ? 'Official' : 'Auto-added'}</span>}
        </span>
        <span className={`font-semibold ${urgent ? 'text-urgent' : ''}`}>
          {isDone ? 'Done' : upcoming ? `Starts in ${formatDuration(start.getTime() - now.getTime())}` : `Ends in ${formatDuration(left)}`}
        </span>
      </div>

      <h3 className={`font-display text-lg font-semibold leading-snug ${isDone ? 'text-muted line-through' : ''}`}>{event.name}</h3>
      {event.note && <p className="text-sm text-muted">{event.note}</p>}
      {event.official_url && (
        <a href={event.official_url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 w-fit items-center text-xs font-semibold text-accent hover:underline">
          Open the event page
        </a>
      )}

      {passed !== null && !isDone && (
        <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-line">
          <div className={`h-full ${urgent ? 'bg-urgent' : gameBg(game)}`} style={{ width: `${passed}%` }} />
        </div>
      )}

      {/* Date and buttons share a row, so cards stay short on a phone */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-xs text-muted">
          {upcoming ? `${formatWhen(start, now)} to ${formatWhen(end, now)}` : `Ends ${formatWhen(end, now)}`}
          {!event.remind && ' · no reminder'}
        </p>

        <div className="flex gap-1.5">
          {!upcoming && (
            <button type="button" onClick={() => onDone(!isDone)} className="min-h-9 rounded-lg border border-line px-3 text-xs font-semibold text-muted hover:text-ink">
              {isDone ? 'Not done' : 'Mark done'}
            </button>
          )}
          <button type="button" onClick={onEdit} className="min-h-9 rounded-lg border border-line px-3 text-xs font-semibold text-muted hover:text-ink">
            Edit
          </button>
        </div>
      </div>
    </article>
  )
}

// ---- Timeline: one bar per event and per endgame cycle, over the next six weeks (three on a phone) ----

export function Timeline({ games, events, now, onOpen }: { games: Game[]; events: GameEvent[]; now: Date; onOpen: (event: GameEvent) => void }) {
  // A phone shows fewer weeks so the whole timeline fits the screen without scrolling sideways
  const phone = useMedia(PHONE)
  const beforeDays = phone ? 1 : 2
  const days = phone ? 21 : 44
  // Bars narrower than this put their name beside the bar instead of inside it
  const minInside = phone ? 40 : 12
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - beforeDays).getTime()
  const span = days * DAY
  const percent = (t: number) => Math.min(100, Math.max(0, ((t - from) / span) * 100))
  const weeks = Array.from({ length: Math.ceil(days / 7) }, (_, i) => new Date(from + i * 7 * DAY))

  const groups = games
    .map((game) => {
      const bars: { key: string; label: string; start: number; end: number; openStart?: boolean; event?: GameEvent }[] = []
      for (const e of events.filter((x) => x.game_id === game.id)) {
        // No start date means it's already running; the bar fades in from the left edge
        const start = e.starts_at ? new Date(e.starts_at).getTime() : from
        bars.push({ key: e.id, label: e.name, start, end: new Date(e.ends_at).getTime(), openStart: !e.starts_at, event: e })
      }
      // Events in the order they start (then end, then name), like a schedule
      bars.sort((a, b) => a.start - b.start || a.end - b.end || a.label.localeCompare(b.label))
      // Endgame cycles come from the reset rules, so they fill in on their own; they go first
      const cycles: typeof bars = []
      for (const t of game.tasks.filter((x) => x.category === 'endgame' && isVisible(x))) {
        const period = taskPeriod(t, clockOf(game), now)
        if (period?.end) cycles.push({ key: t.id, label: t.title, start: period.start.getTime(), end: period.end.getTime() })
      }
      cycles.sort((a, b) => a.end - b.end || a.label.localeCompare(b.label))
      return { game, bars: [...cycles, ...bars].filter((b) => b.end > from && b.start < from + span) }
    })
    .filter((g) => g.bars.length > 0)

  if (groups.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <h2 className="text-sm font-semibold">Timeline · next {phone ? 3 : 6} weeks</h2>
        <span className="text-xs text-muted">Solid bars are events, outlined bars are endgame cycles. A faded edge means it was already running.</span>
      </div>
      <div
        role="region"
        aria-label="Event and endgame timeline. Scroll horizontally on wider screens."
        tabIndex={0}
        className="rounded-2xl border border-line bg-surface focus-visible:outline-offset-4 md:overflow-x-auto"
      >
        <div className="relative min-w-0 p-3 md:min-w-[760px] md:p-4">
          {/* Week marks */}
          <div className="relative h-5 text-[11px] text-muted">
            {weeks.map((w) => (
              <span key={w.getTime()} className="absolute top-0 border-l border-line pl-1.5" style={{ left: `${percent(w.getTime())}%` }}>
                {w.toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </span>
            ))}
          </div>

          <div className="relative mt-1 flex flex-col gap-4">
            {/* Today: drawn behind the bars and names */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-0 w-px bg-ink/50" style={{ left: `${percent(now.getTime())}%` }} />

            {groups.map(({ game, bars }) => (
              <div key={game.id} className="flex flex-col gap-1.5">
                <span className="relative z-10 flex w-fit items-center gap-2 bg-surface pr-2 text-xs font-semibold text-muted">
                  <span aria-hidden="true" className={`size-2.5 rounded-sm ${gameBg(game)}`} />
                  {game.name}
                </span>
                {bars.map((bar) => {
                  const left = percent(bar.start)
                  const right = percent(bar.end)
                  const width = Math.max(2, right - left)
                  const style = { left: `${left}%`, width: `${width}%` }
                  const title = `${bar.label} · ends ${formatWhen(new Date(bar.end), now)}`
                  // A short bar gets its name beside it, on whichever side has more room
                  const inside = width >= minInside
                  const nameOnLeft = left > 100 - right
                  const outsideStyle = nameOnLeft ? { right: `${100 - left}%`, maxWidth: `${left}%` } : { left: `${right}%`, maxWidth: `${100 - right}%` }
                  const outsideClass = `absolute inset-y-0 z-10 flex items-center truncate px-2 text-xs ${nameOnLeft ? 'justify-end' : ''}`
                  return (
                    <div key={bar.key} className="relative h-11 md:h-7">
                      {bar.event ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onOpen(bar.event!)}
                            title={title}
                            aria-label={inside ? undefined : bar.label}
                            style={style}
                            className={`absolute inset-y-0 z-10 truncate px-2 text-left text-xs font-semibold text-on-accent ${gameBg(game)} ${bar.openStart ? 'rounded-r-md pl-6' : 'rounded-md'}`}
                          >
                            {bar.openStart && (
                              <span aria-hidden="true" className="absolute inset-y-0 left-0 w-5" style={{ background: 'linear-gradient(to right, var(--color-surface), transparent)' }} />
                            )}
                            {inside && bar.label}
                          </button>
                          {!inside && (
                            <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => onOpen(bar.event!)} style={outsideStyle} className={`${outsideClass} font-semibold text-ink`}>
                              <span className="truncate">{bar.label}</span>
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <span title={title} style={style} className="absolute inset-y-0 z-10 flex items-center truncate rounded-md border border-line bg-raised px-2 text-xs text-muted">
                            {inside && <span className="truncate">{bar.label}</span>}
                          </span>
                          {!inside && (
                            <span style={outsideStyle} className={`${outsideClass} text-muted`}>
                              <span className="truncate">{bar.label}</span>
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

