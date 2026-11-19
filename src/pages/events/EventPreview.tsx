import { useEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { GameEvent } from '../../lib/events'
import type { PathItem } from '../../lib/eventPath'

// EVT-14: a quick look at an event while the mouse rests on it, or keyboard focus reaches it: the event's
// card (or, for an endgame reset, a small note), floating just below the item, or above it near the
// bottom of the screen. Touch screens have no hover, so a tap goes straight to the full details.
// The preview is only a picture of what the item already says in words (its label), so screen readers skip it.

export type PreviewTarget = { kind: 'event'; event: GameEvent } | { kind: 'cycle'; item: PathItem }
export type PreviewHandlers = {
  onPointerEnter: (e: PointerEvent<HTMLElement>) => void
  onPointerLeave: () => void
  onPointerDown: () => void
  onFocus: (e: FocusEvent<HTMLElement>) => void
  onBlur: () => void
}
export type PreviewBind = (target: PreviewTarget) => PreviewHandlers

const WIDTH = 340
const ROOM = 250 // about a preview's height: it goes below the item unless there's no room there
const DELAY = 160 // a pause first, so sweeping the mouse across the path doesn't flash every card

type Spot = { left: number; top?: number; bottom?: number }

export function usePreview(render: (target: PreviewTarget) => ReactNode) {
  const [shown, setShown] = useState<{ target: PreviewTarget; spot: Spot } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const show = (target: PreviewTarget, el: Element) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (!el.isConnected) return
      const r = el.getBoundingClientRect()
      const left = Math.max(12, Math.min(r.left, window.innerWidth - WIDTH - 12))
      const below = r.bottom + ROOM < window.innerHeight || r.top < ROOM
      setShown({ target, spot: below ? { left, top: r.bottom + 10 } : { left, bottom: window.innerHeight - r.top + 10 } })
    }, DELAY)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setShown(null)
  }

  // It's placed for where the item is on screen, so scrolling or resizing puts it away
  useEffect(() => {
    if (!shown) return
    const away = () => setShown(null)
    window.addEventListener('scroll', away, { passive: true, capture: true })
    window.addEventListener('resize', away)
    return () => {
      window.removeEventListener('scroll', away, { capture: true })
      window.removeEventListener('resize', away)
    }
  }, [shown])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const bind: PreviewBind = (target) => ({
    onPointerEnter: (e) => {
      if (e.pointerType === 'mouse') show(target, e.currentTarget)
    },
    onPointerLeave: hide,
    onPointerDown: hide,
    onFocus: (e) => {
      if (e.currentTarget.matches(':focus-visible')) show(target, e.currentTarget)
    },
    onBlur: hide,
  })

  const node = shown
    ? createPortal(
        <div aria-hidden="true" className="gc-peek" style={{ left: shown.spot.left, top: shown.spot.top, bottom: shown.spot.bottom, width: WIDTH }}>
          {render(shown.target)}
        </div>,
        document.body,
      )
    : null

  return { bind, node }
}
