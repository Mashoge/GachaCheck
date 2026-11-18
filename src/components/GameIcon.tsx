import { useState } from 'react'
import { cx } from './ui/cx'

// LTR-8: a game's icon. Your own upload when you set one (private, signed link), otherwise a text badge
// in the game's colour. The app itself ships no official game art. Decoration next to the game's name,
// so it is hidden from screen readers.
const BADGE: Record<string, string> = { genshin: 'GI', wuwa: 'WW', nte: 'NTE' }
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
  const label = BADGE[key] ?? '•'
  return (
    <span aria-hidden="true" className={cx(shape, 'bg-raised font-bold leading-none', TEXT[key] ?? 'text-muted')}
      style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * (label.length > 2 ? 0.3 : 0.38))) }}>
      {label}
    </span>
  )
}
