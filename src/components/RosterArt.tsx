import { useEffect, useRef, useState } from 'react'
import type { CharacterImage } from '../lib/characterImages'
import { useMedia } from '../lib/useMedia'

// LTR-8 on the THM-6 roster cards: your own character pictures, behind the text on the card's right side.
// They appear when the card wakes up (CSS in index.css) and take turns every few seconds while it stays
// awake; each new visit starts with the next character. Decoration only, so hidden from screen readers.
const TURN_MS = 3500

export function RosterArt({ images }: { images: CharacterImage[] }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [broken, setBroken] = useState<Set<string>>(() => new Set())
  const shown = images.filter((img) => img.url && !broken.has(img.id))
  const count = shown.length
  const [turn, setTurn] = useState(0)
  const [awake, setAwake] = useState(false)
  const still = useMedia('(prefers-reduced-motion: reduce)')

  // Follow the card's own wake-up: mouse hover or keyboard focus inside it
  useEffect(() => {
    const card = ref.current?.parentElement
    if (!card || count === 0) return
    let visited = false
    const wake = () => {
      if (visited) setTurn((t) => t + 1) // a new visit shows the next character
      visited = true
      setAwake(true)
    }
    const sleep = () => setAwake(false)
    const enter = (e: PointerEvent) => { if (e.pointerType === 'mouse') wake() }
    const leave = (e: PointerEvent) => { if (e.pointerType === 'mouse') sleep() }
    const focusOut = (e: FocusEvent) => { if (!card.contains(e.relatedTarget as Node | null)) sleep() }
    card.addEventListener('pointerenter', enter)
    card.addEventListener('pointerleave', leave)
    card.addEventListener('focusin', wake)
    card.addEventListener('focusout', focusOut)
    return () => {
      card.removeEventListener('pointerenter', enter)
      card.removeEventListener('pointerleave', leave)
      card.removeEventListener('focusin', wake)
      card.removeEventListener('focusout', focusOut)
    }
  }, [count])

  // Take turns while awake (not with reduced motion: then the picture just stays)
  useEffect(() => {
    if (!awake || still || count < 2) return
    const timer = window.setInterval(() => setTurn((t) => t + 1), TURN_MS)
    return () => window.clearInterval(timer)
  }, [awake, still, count])

  if (count === 0) return null
  const current = turn % count
  return (
    <span ref={ref} aria-hidden="true" className="gc-roster-art">
      {shown.map((img, i) => (
        <img
          key={img.id}
          src={img.url!}
          alt=""
          decoding="async"
          draggable={false}
          data-on={i === current ? '' : undefined}
          style={{ objectPosition: `${img.focusX}% ${img.focusY}%` }}
          onError={() => setBroken((b) => new Set(b).add(img.id))}
        />
      ))}
    </span>
  )
}
