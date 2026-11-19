import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import type { GameEvent } from '../../lib/events'
import { buildPath, daysBetween, stopGap, type PathItem } from '../../lib/eventPath'
import { formatDuration, formatWhen } from '../../lib/time'
import type { Game } from '../../lib/today'
import { PHONE, useMedia } from '../../lib/useMedia'
import { GameIcon } from '../../components/GameIcon'

// EVT-13: the "path" timeline. A slanted spine runs down the card, today at the top; each day with
// something on it is a stop, with its items on a rail as slanted chips: an event ending (solid, with an
// arrow tip), an event starting (outlined) or an endgame mode resetting (dark, with the game's edge).
// Stops further apart in time sit further apart. One CSS skew leans the whole path (index.css,
// .gc-path); text inside is set upright again. Clicking an event's chip opens it.

const time = (at: Date) => at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const WORD = { end: 'ends', start: 'starts', cycle: 'resets' } as const

function Chip({ item, icon, now, onOpen }: { item: PathItem; icon?: string; now: Date; onOpen: (e: GameEvent) => void }) {
  const left = item.soon ? formatDuration(item.at.getTime() - now.getTime()) : null
  const body = (
    <>
      <span className="gc-pchip-em"><GameIcon presetId={item.game.preset_id} url={icon} size={20} /></span>
      <span className="gc-pchip-name">{item.label}</span>
      {left ? <b className="gc-pchip-left">{left} left</b> : <small>{WORD[item.kind]} {time(item.at)}</small>}
    </>
  )
  const said = `${item.label}, ${item.game.name}: ${WORD[item.kind]} ${formatWhen(item.at, now)}${left ? `, ${left} left` : ''}`
  return item.event ? (
    <button type="button" className="gc-pchip" data-kind={item.kind} data-game={item.game.preset_id ?? undefined} data-soon={item.soon ? '' : undefined}
      aria-label={said} title={said} onClick={() => onOpen(item.event!)}>
      {body}
    </button>
  ) : (
    <span className="gc-pchip" data-kind={item.kind} data-game={item.game.preset_id ?? undefined} title={said}>
      <span className="sr-only">{said}</span>
      <span aria-hidden="true" className="contents">{body}</span>
    </span>
  )
}

export function EventPath({ games, events, icons = {}, now, onOpen }: {
  games: Game[]
  events: GameEvent[]
  icons?: Record<string, string>
  now: Date
  onOpen: (event: GameEvent) => void
}) {
  const phone = useMedia(PHONE)
  const angle = phone ? 3.5 : 8
  const days = buildPath(games, events, now)
  const running = events.filter((e) => (!e.starts_at || new Date(e.starts_at) <= now) && new Date(e.ends_at) > now)
  const nextEnd = days.flatMap((d) => d.items).find((i) => i.kind === 'end')

  // The lean: the bottom of the path sits at the label column, so its top starts further right by
  // height × tan(angle). Re-measured whenever the path changes height.
  const path = useRef<HTMLOListElement>(null)
  useLayoutEffect(() => {
    const el = path.current
    if (!el) return
    const lean = () => el.style.setProperty('--drift', `${Math.round(el.offsetHeight * Math.tan((angle * Math.PI) / 180))}px`)
    lean()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(lean)
    watch.observe(el)
    return () => watch.disconnect()
  }, [angle])

  // Each stop's gap above it (by days since the stop before) and whether a new month starts there
  const stops = days.map(({ day, items }, i) => {
    const before = i === 0 ? now : days[i - 1].day
    return { day, items, gap: stopGap(daysBetween(before, day), phone), newMonth: day.getMonth() !== before.getMonth() }
  })

  return (
    <div className="gc-pathbox">
      <ol ref={path} className="gc-path" aria-label="Coming up, day by day" style={{ '--skew': `-${angle}deg`, '--unskew': `${angle}deg` } as CSSProperties}>
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
        {stops.map(({ day, items, gap, newMonth }) => {
          return (
            <li key={day.getTime()} className="gc-stop" data-soon={items.some((i) => i.soon) ? '' : undefined} style={{ marginTop: gap }}>
              {newMonth && <span aria-hidden="true" className="gc-stop-month">{day.toLocaleDateString([], { month: 'long' })}</span>}
              <span aria-hidden="true" className="gc-rail" />
              <span aria-hidden="true" className="gc-node" />
              <time className="gc-stop-date" dateTime={day.toISOString().slice(0, 10)}>
                <span className="gc-stop-wd">{day.toLocaleDateString([], { weekday: 'short' })}</span>
                <span className="gc-stop-dt">{day.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
              </time>
              <ul className="gc-stop-items">
                {items.map((item) => (
                  <li key={item.key}><Chip item={item} icon={icons[item.game.id]} now={now} onOpen={onOpen} /></li>
                ))}
              </ul>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
