import { useState, type ReactNode } from 'react'
import { cx } from './ui/cx'

// LTR-8: a game's icon. Your own upload when you set one (private, signed link), otherwise our own emblem
// in the game's colour (THM-13), drawn from each game's themes: Genshin's four-point star; WuWa's sound
// and resonance as frequency needles; NTE's folklore as a ghost drifting off in its diagonal slash. Drawn
// by us, not the games' logos; the app ships no official game art. Decoration next to the game's name,
// so it is hidden from screen readers.
const CUT = 'var(--color-raised)' // details cut out of a filled emblem show the badge's background
const EMBLEM: Record<string, ReactNode> = {
  genshin: (
    <>
      <path d="M12 3.2 13.9 10.1 20.8 12 13.9 13.9 12 20.8 10.1 13.9 3.2 12 10.1 10.1Z" fill="currentColor" />
      <circle cx="18.2" cy="5.8" r="1.1" fill="currentColor" opacity="0.7" />
    </>
  ),
  wuwa: (
    <g fill="currentColor">
      <path d="M4.2 9.6 5.5 12 4.2 14.4 2.9 12z" />
      <path d="M8.1 6.4 9.5 12 8.1 17.6 6.7 12z" />
      <path d="M12 2.8 13.6 12 12 21.2 10.4 12z" />
      <path d="M15.9 6.4 17.3 12 15.9 17.6 14.5 12z" />
      <path d="M19.8 9.6 21.1 12 19.8 14.4 18.5 12z" />
    </g>
  ),
  nte: (
    <>
      <path d="M14.6 3.4a6.2 6.2 0 0 1 4.6 10.1c-1.9 2.4-4.3 3.5-6.9 4.4-2.4.8-4.8 1.6-7.6 3.6 1-2.6 2.3-4.1 3.6-5.4-1.8-.6-2.8-2.1-2.8-4a8.8 8.8 0 0 1 9.1-8.7z" fill="currentColor" />
      <path d="M12.4 8.4h1.7l-.7 3.1h-1.7zM16 8.4h1.7l-.7 3.1h-1.7z" fill={CUT} />
    </>
  ),
}
const RING: Record<string, string> = { genshin: 'ring-game-genshin', wuwa: 'ring-game-wuwa', nte: 'ring-game-nte' }
const TEXT: Record<string, string> = { genshin: 'text-game-genshin', wuwa: 'text-game-wuwa', nte: 'text-game-nte' }

export function GameIcon({ presetId, url, size = 20, className }: {
  presetId: string | null
  url?: string | null
  size?: number
  className?: string
}) {
  const [broken, setBroken] = useState<string | null>(null)
  const key = presetId ?? ''
  const shape = cx('inline-grid shrink-0 place-items-center overflow-hidden rounded-full ring-1', RING[key] ?? 'ring-muted', className)
  if (url && broken !== url) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        decoding="async"
        draggable={false}
        className={cx(shape, 'bg-raised object-cover')}
        style={{ width: size, height: size }}
        onError={() => setBroken(url)}
      />
    )
  }
  const emblem = EMBLEM[key]
  return (
    <span aria-hidden="true" className={cx(shape, 'bg-raised font-bold leading-none', TEXT[key] ?? 'text-muted')}
      style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.38)) }}>
      {emblem ? <svg viewBox="0 0 24 24" width={Math.round(size * 0.66)} height={Math.round(size * 0.66)}>{emblem}</svg> : '•'}
    </span>
  )
}
