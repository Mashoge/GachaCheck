import { useEffect, useState } from 'react'
import type { CharacterImage } from '../lib/characterImages'
import { useMedia } from '../lib/useMedia'

// LTR-8 on the Today cards: your own character pictures, behind the text on the card's right side.
// They appear when the card wakes up (TodayCard.tsx, CSS in index.css) and take turns every few seconds
// while it stays awake; each new visit starts with the next character. Decoration only, so hidden from
// screen readers.
const TURN_MS = 3500

export function RosterArt({ images, awake }: { images: CharacterImage[]; awake: boolean }) {
  const [broken, setBroken] = useState<Set<string>>(() => new Set())
  const shown = images.filter((img) => img.url && !broken.has(img.id))
  const count = shown.length
  const [turn, setTurn] = useState(0)
  const [visits, setVisits] = useState(0)
  const still = useMedia('(prefers-reduced-motion: reduce)')

  // Each new visit starts with the next character
  const [wasAwake, setWasAwake] = useState(awake)
  if (awake !== wasAwake) {
    setWasAwake(awake)
    if (awake) setVisits((v) => v + 1)
  }

  // Take turns while awake (not with reduced motion: then the picture just stays)
  useEffect(() => {
    if (!awake || still || count < 2) return
    const timer = window.setInterval(() => setTurn((t) => t + 1), TURN_MS)
    return () => window.clearInterval(timer)
  }, [awake, still, count])

  if (count === 0) return null
  const current = (Math.max(0, visits - 1) + turn) % count
  return (
    <span aria-hidden="true" className="gc-roster-art">
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
