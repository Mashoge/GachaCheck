import { Children, type ReactNode } from 'react'
import type { GameEvent } from '../../lib/events'
import { formatDuration, formatWhen, taskPeriod } from '../../lib/time'
import { clockOf, isVisible, type Game } from '../../lib/today'
import { PHONE, useMedia } from '../../lib/useMedia'
import { SHORT_NAMES } from '../../lib/useGames'
import { GameIcon } from '../../components/GameIcon'
import { Button, ExternalIcon, IconTag, buttonClass, cx } from '../../components/ui'

const DAY = 86_400_000
const SOON_MS = 3 * DAY
const GAME_BG: Record<string, string> = { genshin: 'bg-game-genshin', wuwa: 'bg-game-wuwa', nte: 'bg-game-nte' }
const gameBg = (game: Game | undefined) => GAME_BG[game?.preset_id ?? ''] ?? 'bg-accent'
const shortName = (game: Game | undefined) => (game ? (SHORT_NAMES[game.preset_id ?? ''] ?? game.name) : 'Unknown game')

// THM-9 (step 3): sections and cards in the Today page's voice: a count tag beside each heading, and
// cards with the game's label, slanted tags, a big countdown, a slanted bar and a footer for the buttons.
export function Section({ title, hint, urgent = false, children }: { title: string; hint?: string; urgent?: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="gc-tag" data-tone={urgent ? 'urgent' : 'rest'}>{Children.count(children)}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  )
}

export function EventCard({ event, game, iconUrl, now, onEdit, onDone }: {
  event: GameEvent
  game: Game | undefined
  iconUrl?: string
  now: Date
  onEdit: () => void
  onDone: (done: boolean) => void
}) {
  const start = event.starts_at ? new Date(event.starts_at) : null
  const end = new Date(event.ends_at)
  const isDone = !!event.completed_at
  const upcoming = !!start && start > now
  const left = end.getTime() - now.getTime()
  const urgent = !isDone && !upcoming && left <= SOON_MS
  // How much of the event has passed (only when its start is known)
  const passed = start && !upcoming ? Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100)) : null

  return (
    <article
      data-game={game?.preset_id ?? undefined}
      className={cx('gc-set flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-surface', urgent ? 'border-urgent' : 'border-line')}
    >
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <GameIcon presetId={game?.preset_id ?? null} url={iconUrl} size={20} />
          <span className="gc-label">{shortName(game)}</span>
          {event.source !== 'manual' && (
            event.origin === 'catalog' ? <IconTag icon="official" /> : <IconTag icon="auto" tone="rest" />
          )}
          {event.kind === 'web_event' && <IconTag icon="web" tone="rest" />}
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className={cx('font-display text-lg font-semibold leading-snug', isDone && 'text-muted line-through')}>{event.name}</h3>
            {event.note && <p className="mt-1 text-sm text-muted">{event.note}</p>}
          </div>
          {isDone ? (
            <span className="gc-tag shrink-0" data-tone="rest">Done</span>
          ) : (
            <p className="flex shrink-0 flex-col items-end">
              <span className="gc-label">{upcoming ? 'Starts in' : 'Ends in'}</span>
              <span className={cx('mt-1 font-display text-2xl font-bold leading-none whitespace-nowrap', urgent && 'text-urgent')}>
                {formatDuration(upcoming ? start.getTime() - now.getTime() : left)}
              </span>
            </p>
          )}
        </div>

        <div className="mt-auto flex flex-col gap-2">
          {passed !== null && !isDone && (
            <div aria-hidden="true" className="gc-slant-bar">
              <i style={{ width: `${passed}%`, background: urgent ? 'var(--color-urgent)' : 'var(--gc)' }} />
            </div>
          )}
          <p className="text-xs text-muted">
            {upcoming ? `${formatWhen(start, now)} to ${formatWhen(end, now)}` : `Ends ${formatWhen(end, now)}`}
            {!event.remind && ' · no reminder'}
          </p>
        </div>
      </div>

      <div className="flex min-h-12 flex-wrap items-center gap-1.5 border-t border-line px-3 py-1.5">
        {event.official_url && (
          <a href={event.official_url} target="_blank" rel="noreferrer" className={buttonClass({ variant: 'link', size: 'sm' })}>
            Event page <ExternalIcon size={13} />
          </a>
        )}
        <span className="ml-auto flex gap-1.5">
          {!upcoming && (
            <Button size="sm" variant="secondary" onClick={() => onDone(!isDone)} aria-label={`${isDone ? 'Not done' : 'Mark done'}: ${event.name}`}>
              {isDone ? 'Not done' : 'Mark done'}
            </Button>
          )}
          <Button size="sm" variant="quiet" onClick={onEdit} aria-label={`Edit ${event.name}`}>
            Edit
          </Button>
        </span>
      </div>
    </article>
  )
}

// ---- Timeline: one bar per event and per endgame cycle, over the next six weeks (three on a phone) ----

export function Timeline({ games, events, icons = {}, now, onOpen }: { games: Game[]; events: GameEvent[]; icons?: Record<string, string>; now: Date; onOpen: (event: GameEvent) => void }) {
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
        <h2 className="flex items-center gap-3 text-base font-semibold">
          Timeline <span className="gc-tag" data-tone="rest">Next {phone ? 3 : 6} weeks</span>
        </h2>
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
          <div className="relative h-5">
            {weeks.map((w) => (
              <span key={w.getTime()} className="gc-label absolute top-0 border-l border-line pl-1.5 !text-[10px]" style={{ left: `${percent(w.getTime())}%` }}>
                {w.toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </span>
            ))}
          </div>

          <div className="relative mt-1 flex flex-col gap-4">
            {/* Today: drawn behind the bars and names */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-0 w-px bg-accent/70" style={{ left: `${percent(now.getTime())}%` }} />

            {groups.map(({ game, bars }) => (
              <div key={game.id} className="flex flex-col gap-1.5">
                <span className="relative z-10 flex w-fit items-center gap-2 bg-surface pr-2">
                  <GameIcon presetId={game.preset_id} url={icons[game.id]} size={18} />
                  <span className="gc-label">{game.name}</span>
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
                          <Button
                            variant="quiet"
                            size="sm"
                            onClick={() => onOpen(bar.event!)}
                            title={title}
                            aria-label={inside ? undefined : bar.label}
                            style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', height: '100%', minHeight: 0, paddingInline: 8, color: 'var(--color-on-accent)', borderRadius: bar.openStart ? '0 0.375rem 0.375rem 0' : '0.375rem' }}
                            className={`absolute inset-y-0 z-10 w-auto justify-start truncate rounded-md text-left text-xs font-semibold ${gameBg(game)} ${bar.openStart ? 'rounded-r-md pl-6' : 'rounded-md'}`}
                          >
                            {bar.openStart && (
                              <span aria-hidden="true" className="absolute inset-y-0 left-0 w-5" style={{ background: 'linear-gradient(to right, var(--color-surface), transparent)' }} />
                            )}
                            {inside && bar.label}
                          </Button>
                          {!inside && (
                            <Button variant="quiet" size="sm" tabIndex={-1} aria-hidden="true" onClick={() => onOpen(bar.event!)} style={{ ...outsideStyle, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', height: '100%', minHeight: 0, paddingInline: 8, color: 'var(--color-ink)', borderRadius: 0 }} className={`${outsideClass} w-auto rounded-none justify-start font-semibold`}>
                              <span className="truncate">{bar.label}</span>
                            </Button>
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

