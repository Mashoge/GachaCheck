import { useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router'
import type { GameEvent } from '../../lib/events'
import { buildPath, daysBetween, pathLean, stopGap, type PathItem } from '../../lib/eventPath'
import { formatDuration, formatWhen } from '../../lib/time'
import type { Game } from '../../lib/today'
import { PHONE, useMedia } from '../../lib/useMedia'
import { GameIcon } from '../../components/GameIcon'
import type { PreviewBind } from './EventPreview'

// EVT-13: the "path" timeline. A slanted spine runs down the card, today at the top; each day with
// something on it is a stop, with its items on a rail as slanted chips: an event ending (a dark chip in the
// game's tint with an arrow tip, solid when it ends within three days), an event starting (dashed) or an
// endgame mode resetting (slim and quiet). Stops further apart in time sit further apart, and a long quiet
// stretch says how long it is. One CSS skew leans the whole path (index.css, .gc-path); text inside is set
// upright again.
// EVT-14: the path is the whole Events page. Resting the mouse on an event shows its card; clicking it
// opens its details. An endgame reset links to its game's page. Finished events stay, faded.

const time = (at: Date) => at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const WORD = { end: 'ends', start: 'starts', cycle: 'resets' } as const
// The day as YYYY-MM-DD in your own time zone (toISOString would give the UTC date, a day off east of UTC)
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function Chip({ item, icon, now, selected, onOpen, peek }: {
  item: PathItem
  icon?: string
  now: Date
  selected: boolean
  onOpen: (e: GameEvent) => void
  peek: PreviewBind
}) {
  const left = item.soon ? formatDuration(item.at.getTime() - now.getTime()) : null
  const body = (
    <>
      <span className="gc-pchip-em"><GameIcon presetId={item.game.preset_id} url={icon} size={20} /></span>
      <span className="gc-pchip-name">{item.label}</span>
      {left ? <b className="gc-pchip-left">{left} left</b> : <small>{item.done ? '✓ done' : `${WORD[item.kind]} ${time(item.at)}`}</small>}
    </>
  )
  const said = `${item.label}, ${item.game.name}: ${WORD[item.kind]} ${formatWhen(item.at, now)}${left ? `, ${left} left` : ''}${item.done ? ', done' : ''}`
  const look = {
    className: 'gc-pchip',
    'data-kind': item.kind,
    'data-game': item.game.preset_id ?? undefined,
    'data-soon': item.soon ? '' : undefined,
    'data-done': item.done ? '' : undefined,
  }

  if (item.event) {
    const event = item.event
    return (
      <button type="button" {...look} aria-label={`${said}. Show details`} aria-current={selected ? 'true' : undefined}
        {...peek({ kind: 'event', event })} onClick={() => onOpen(event)}>
        {body}
      </button>
    )
  }
  // An endgame reset: to its game's page, where the mode is ticked off
  if (item.game.preset_id) {
    return (
      <Link to={`/game/${item.game.preset_id}`} {...look} aria-label={`${said}. Open the game page`} {...peek({ kind: 'cycle', item })}>
        {body}
      </Link>
    )
  }
  return (
    <span {...look}>
      <span className="sr-only">{said}</span>
      <span aria-hidden="true" className="contents">{body}</span>
    </span>
  )
}

export function EventPath({ games, events, icons = {}, now, selectedId, onOpen, peek }: {
  games: Game[]
  events: GameEvent[]
  icons?: Record<string, string>
  now: Date
  selectedId?: string
  onOpen: (event: GameEvent) => void
  peek: PreviewBind
}) {
  const phone = useMedia(PHONE)
  const days = buildPath(games, events, now)
  const running = events.filter((e) => !e.completed_at && (!e.starts_at || new Date(e.starts_at) <= now) && new Date(e.ends_at) > now)
  const nextEnd = days.flatMap((d) => d.items).find((i) => i.kind === 'end' && !i.done)

  // The lean: the path's bottom sits at the label column and its top further right. The drift is held to a
  // limit (pathLean), so a long path leans gently instead of leaving an empty wedge beside it; the chips
  // keep the full slant. Re-measured whenever the path changes height.
  const path = useRef<HTMLOListElement>(null)
  const angle = phone ? 3.5 : 8
  const maxDrift = phone ? 34 : 64
  useLayoutEffect(() => {
    const el = path.current
    if (!el) return
    const lean = () => {
      const { drift, spine, chip } = pathLean(el.offsetHeight, angle, maxDrift)
      el.style.setProperty('--drift', `${drift}px`)
      el.style.setProperty('--skew', `-${spine}deg`)
      el.style.setProperty('--unskew', `${spine}deg`)
      el.style.setProperty('--chip-skew', `-${chip}deg`)
      el.style.setProperty('--chip-unskew', `${angle}deg`)
    }
    lean()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(lean)
    watch.observe(el)
    return () => watch.disconnect()
  }, [angle, maxDrift])

  // Each stop's gap above it (by days since the stop before) and whether a new month starts there
  const stops = days.map(({ day, items }, i) => {
    const before = i === 0 ? now : days[i - 1].day
    const apart = daysBetween(before, day)
    return { day, items, apart, gap: stopGap(apart, phone), newMonth: day.getMonth() !== before.getMonth() }
  })

  return (
    <div className="gc-pathbox">
      <ol ref={path} className="gc-path" aria-label="Coming up, day by day">
        <li className="gc-stop" data-today="">
          <span aria-hidden="true" className="gc-rail" />
          <span aria-hidden="true" className="gc-node" />
          <span className="gc-stop-date">
            <span className="gc-stop-wd">{now.toLocaleDateString([], { weekday: 'short' })} {time(now)}</span>
            <span className="gc-stop-dt">Today</span>
          </span>
          <p className="gc-stop-note">
            <span>
              {running.length} {running.length === 1 ? 'event' : 'events'} running
              {nextEnd && ` · next one ends in ${formatDuration(nextEnd.at.getTime() - now.getTime())}`}
            </span>
          </p>
        </li>
        {stops.map(({ day, items, apart, gap, newMonth }) => (
          <li key={day.getTime()} className="gc-stop" data-soon={items.some((i) => i.soon) ? '' : undefined} style={{ marginTop: gap }}>
            {apart >= 4 && <span aria-hidden="true" className="gc-stop-gap" style={{ top: -gap / 2 }}>{apart} days</span>}
            {newMonth && <span aria-hidden="true" className="gc-stop-month">{day.toLocaleDateString([], { month: 'long' })}</span>}
            <span aria-hidden="true" className="gc-rail" />
            <span aria-hidden="true" className="gc-node" />
            <time className="gc-stop-date" dateTime={isoDay(day)}>
              <span className="gc-stop-wd">{day.toLocaleDateString([], { weekday: 'short' })}</span>
              <span className="gc-stop-dt">{day.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
            </time>
            <ul className="gc-stop-items">
              {items.map((item) => (
                <li key={item.key}>
                  <Chip item={item} icon={icons[item.game.id]} now={now} selected={!!item.event && item.event.id === selectedId} onOpen={onOpen} peek={peek} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  )
}
