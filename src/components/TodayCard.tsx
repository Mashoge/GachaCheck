import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronIcon } from './ui'
import { GameIcon } from './GameIcon'
import { RosterArt } from './RosterArt'
import { RosterMotif } from './RosterMotif'
import { cardHeadline, meterTag, type GameCard } from '../lib/today'
import { formatClock, formatDuration } from '../lib/time'
import type { CharacterImage } from '../lib/characterImages'

// THM-8: one Today card. The same structure for every game; the look comes from index.css
// (.gc-card). The body opens the game; the footer (actions, from TodayPage) sits outside the link.
const MAX_PIPS = 10
const RIPPLE: Record<string, string> = { genshin: '#f3d48f', wuwa: '#ffffff', nte: '#ffffff' }

type Tone = 'urgent' | 'rest' | undefined

export function TodayCard({ card, now, iconUrl, images, footer, after }: {
  card: GameCard
  now: Date
  iconUrl?: string
  images: CharacterImage[]
  footer: ReactNode
  after?: ReactNode // opens over the card's bottom, above the footer
}) {
  const ref = useRef<HTMLElement>(null)
  const awake = useAwake(ref)
  usePageGlow(ref, awake, card.presetId)
  const headline = cardHeadline(card, now)
  const m = card.meter
  const left = card.dailyTotal - card.dailyDone
  const allDailies = card.dailyTotal > 0 && left === 0
  const weekDone = card.weeklyTotal > 0 && card.weeklyDone === card.weeklyTotal
  const clear = allDailies && (card.weeklyTotal === 0 || weekDone) && !card.note
  const state = card.skipped ? 'resting' : clear ? 'clear' : undefined

  // The big number and what goes with it
  let label: string
  let tag: { text: string; tone: Tone } | null
  let num: number
  let cap: string
  let pct: number
  let sub: string
  if (headline === 'meter' && m) {
    const t = meterTag(card, now)
    label = m.name
    tag = card.skipped ? { text: 'Resting · no pings', tone: 'rest' } : t && { text: t.text, tone: t.urgent ? 'urgent' : undefined }
    num = m.value
    cap = `/${m.cap}`
    pct = Math.min(100, (m.value / m.cap) * 100)
    // The meter's own time first, so it is clear which meter it belongs to; then the overflow meter
    const own = card.skipped ? 'Skipped today: left out of progress'
      : m.full ? 'Full: refill is being wasted'
      : m.fullAt ? `Full in ${formatDuration(m.fullAt.getTime() - now.getTime())}` : null
    sub = [own, card.overflow ? `${card.overflow.name} ${card.overflow.value}/${card.overflow.cap}` : null].filter(Boolean).join(' · ')
  } else {
    // Dailies lead: in the last hours before reset (dailies left), or for a game without a meter
    const rush = !!m
    label = rush ? 'Dailies left' : 'Dailies'
    tag = rush ? { text: `Reset in ${formatDuration(card.resetAt.getTime() - now.getTime())}`, tone: 'urgent' } : null
    num = rush ? left : card.dailyDone
    cap = rush ? `left of ${card.dailyTotal}` : `/${card.dailyTotal}`
    pct = card.dailyTotal ? (card.dailyDone / card.dailyTotal) * 100 : 0
    sub = `${card.dailyDone} of ${card.dailyTotal} done · reset at ${formatClock(card.resetAt)}`
  }
  const meterRow = headline === 'dailies' && m
  const [restNum, gameNum] = [useRef<HTMLElement>(null), useRef<HTMLElement>(null)]
  useFitNumerals(restNum, gameNum, num)

  // NTE's ticker spells out the card's status
  const ticker = card.skipped ? 'Resting today'
    : tag?.tone === 'urgent' ? tag.text
    : clear ? 'All clear today'
    : left > 0 ? `${left} ${left === 1 ? 'daily' : 'dailies'} left` : 'Dailies done'

  // A tap on a footer button grows a circle from where you pressed (each game's own tap feedback)
  const ripple = (e: ReactPointerEvent<HTMLDivElement>) => {
    const button = (e.target as HTMLElement).closest('button')
    if (!button) return
    const r = button.getBoundingClientRect()
    const size = Math.max(r.width, r.height) * 2.2
    const dot = document.createElement('span')
    dot.className = 'gc-ripple'
    dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px;--rip:${RIPPLE[card.presetId] ?? '#fff'}`
    button.appendChild(dot)
    window.setTimeout(() => dot.remove(), 600)
  }

  return (
    <article
      ref={ref}
      data-game={card.presetId}
      data-state={state}
      data-awake={awake ? '' : undefined}
      className="gc-card flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-accent"
    >
      <div className="gc-body flex flex-1 flex-col p-4 sm:px-[18px]">
        {/* Decoration: hidden from screen readers, behind the text */}
        <span aria-hidden="true" className="gc-skin" />
        {card.presetId === 'wuwa' && (
          <>
            <span aria-hidden="true" className="gc-frame" />
            <span aria-hidden="true" className="gc-spark" style={{ right: 26, top: 70 }}>✦</span>
            <span aria-hidden="true" className="gc-spark" style={{ right: '44%', top: 150, fontSize: 8 }}>✦</span>
          </>
        )}
        {card.presetId === 'nte' && (
          <>
            <span aria-hidden="true" className="gc-mark">
              {['DAILIES DAILIES DAILIES', 'TODAY TODAY TODAY', 'DAILIES DAILIES DAILIES', 'TODAY TODAY TODAY', 'DAILIES DAILIES DAILIES'].map((t, i) => (
                <b key={i} style={{ paddingLeft: i % 2 ? '2ch' : 0 }}>{t}</b>
              ))}
            </span>
            <span aria-hidden="true" className="gc-ticker"><span>{Array(10).fill(ticker.toUpperCase()).join(' ▸ ')} ▸</span></span>
            <span aria-hidden="true" className="gc-sweep" />
            <span aria-hidden="true" className="gc-lines" />
          </>
        )}
        {images.length > 0 && <RosterArt images={images} awake={awake} />}
        <RosterMotif game={card.presetId} />

        {/* Name: the whole body is the link to the game */}
        <span className="flex items-center gap-2">
          <GameIcon presetId={card.presetId} url={iconUrl} size={22} />
          <Link to={`/game/${card.presetId}`} className="min-w-0 flex-1 leading-tight font-semibold after:absolute after:inset-0 focus-visible:outline-none">
            <span className="sr-only">Open </span>
            {card.name}
          </Link>
          <span className="gc-reset shrink-0 text-xs text-muted">Reset in {formatDuration(card.resetAt.getTime() - now.getTime())}</span>
          <span aria-hidden="true" className="gc-chev -mr-1 text-muted transition-[color,translate]">
            <ChevronIcon size={16} />
          </span>
        </span>

        <span className="mt-5 flex items-center justify-between gap-3">
          <span className="gc-label">{label}</span>
          {tag && <span className="gc-tag" data-tone={tag.tone}>{tag.text}</span>}
        </span>
        <span className="gc-hero mt-1.5">
          <span className="gc-numwrap">
            <b ref={restNum} className="gc-num gc-num-rest">{num}</b>
            <b ref={gameNum} className="gc-num gc-num-game" aria-hidden="true">{num}</b>
          </span>
          <span className="gc-cap">{cap}</span>
        </span>
        <span aria-hidden="true" className="gc-meter mt-2.5" style={{ '--p': `${pct}%` } as CSSProperties}><i /></span>
        <span className="gc-sub mt-2 text-xs text-muted">{sub}</span>

        <span aria-hidden="true" className="gc-rule mt-3.5 mb-2.5" />
        {meterRow ? (
          <Row label={m.name}>
            <span className="gc-val ml-auto shrink-0 whitespace-nowrap">{m.value}/{m.cap}</span>
          </Row>
        ) : headline === 'meter' && card.dailyTotal > 0 && (
          <Row label="Dailies">
            {card.dailyTotal <= MAX_PIPS && (
              <span aria-hidden="true" className="gc-pips min-w-0 flex-1 overflow-hidden">
                {Array.from({ length: card.dailyTotal }, (_, i) => <i key={i} data-on={i < card.dailyDone ? '' : undefined} />)}
              </span>
            )}
            <span className="gc-val ml-auto shrink-0 whitespace-nowrap">{card.skipped ? 'Resting' : allDailies ? 'All done' : `${card.dailyDone}/${card.dailyTotal}`}</span>
          </Row>
        )}
        {card.weeklyTotal > 0 && (
          <Row label="This week">
            <span className="text-sm">{weekDone ? 'All done' : `${card.weeklyDone}/${card.weeklyTotal}`}</span>
          </Row>
        )}
        {card.note ? (
          <span className="gc-end mt-2 flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 text-sm font-semibold">
              {card.note.title}
              <span className="gc-endsub block text-xs font-normal text-muted">Not cleared</span>
            </span>
            {card.note.at && (
              <span className={`gc-endtime shrink-0 font-display font-semibold ${card.note.soon ? 'text-urgent' : ''}`}>
                {formatDuration(card.note.at.getTime() - now.getTime())}
              </span>
            )}
          </span>
        ) : card.hasEndgame && (
          <span className="gc-end mt-2 flex items-center justify-between gap-3 py-2">
            <span className="text-sm font-semibold">Endgame<span className="gc-endsub block text-xs font-normal text-muted">This cycle</span></span>
            <span className="gc-endtime font-display font-semibold">All cleared</span>
          </span>
        )}
      </div>

      {/* Something asked after an action (the spend prompt) opens over the bottom of this card, just
          above the footer, so the other cards in the row keep their size and Undo stays in reach */}
      <div className="relative">
        {after && (
          <div className="absolute inset-x-0 bottom-full z-10 border-t border-line shadow-[0_-16px_24px_-12px_rgb(0_0_0/0.7)] [&_form]:border-b-0">
            {after}
          </div>
        )}
        <div className="gc-foot flex min-h-14 flex-wrap items-center gap-2 border-t border-line px-4 py-2.5" onPointerDown={ripple}>
          {footer}
        </div>
      </div>
    </article>
  )
}

/**
 * The game's numerals are drawn at whatever size makes them exactly as wide as the app's, for the number
 * showing, so "/200" never moves when the card wakes (fonts differ most on a "1"). Re-measured when the
 * number changes and once the game fonts arrive.
 */
function useFitNumerals(rest: React.RefObject<HTMLElement | null>, game: React.RefObject<HTMLElement | null>, value: number) {
  useLayoutEffect(() => {
    const fit = () => {
      const r = rest.current
      const g = game.current
      if (!r || !g || !document.documentElement.hasAttribute('data-gamefonts')) return
      g.style.removeProperty('--fit')
      const rw = r.getBoundingClientRect().width
      const gw = g.getBoundingClientRect().width
      if (rw > 0 && gw > 0) g.style.setProperty('--fit', String(Math.min(1.3, Math.max(0.75, rw / gw))))
    }
    fit()
    const watch = new MutationObserver(fit)
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-gamefonts'] })
    return () => watch.disconnect()
  }, [rest, game, value])
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex min-h-7 items-center gap-3">
      <span className="gc-label min-w-24 shrink-0">{label}</span>
      {children}
    </span>
  )
}

/**
 * THM-9: the page reacts to the woken card. Its game's colour takes over the backdrop's glow, centred
 * above the card, and fades back when the card sleeps (CSS: .gc-backdrop::after). The last game's
 * colour stays set while it fades out, so the glow never snaps to grey.
 */
function usePageGlow(ref: React.RefObject<HTMLElement | null>, awake: boolean, game: string) {
  useEffect(() => {
    const root = document.documentElement
    if (!awake) return
    const r = ref.current?.getBoundingClientRect()
    if (r) root.style.setProperty('--wake-x', `${Math.round(((r.left + r.width / 2) / window.innerWidth) * 100)}%`)
    root.dataset.wakeGame = game
    root.setAttribute('data-wake', '')
    return () => {
      if (root.dataset.wakeGame === game) root.removeAttribute('data-wake')
    }
  }, [ref, awake, game])
}

/**
 * Awake = the one card you are pointing at with a mouse, the card holding keyboard focus, or the card
 * you are pressing on a touch screen. One state for colours, numerals, motion and your pictures.
 */
function useAwake(ref: React.RefObject<HTMLElement | null>) {
  const [awake, setAwake] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const enter = (e: PointerEvent) => { if (e.pointerType === 'mouse') setAwake(true) }
    const leave = (e: PointerEvent) => { if (e.pointerType === 'mouse') setAwake(false) }
    const down = (e: PointerEvent) => { if (e.pointerType !== 'mouse') setAwake(true) }
    const up = (e: PointerEvent) => { if (e.pointerType !== 'mouse') setAwake(false) }
    const focusIn = (e: FocusEvent) => { if ((e.target as Element).matches?.(':focus-visible')) setAwake(true) }
    const focusOut = (e: FocusEvent) => { if (!el.contains(e.relatedTarget as Node | null)) setAwake(false) }
    el.addEventListener('pointerenter', enter)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('focusin', focusIn)
    el.addEventListener('focusout', focusOut)
    return () => {
      el.removeEventListener('pointerenter', enter)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('focusin', focusIn)
      el.removeEventListener('focusout', focusOut)
    }
  }, [ref])
  return awake
}
