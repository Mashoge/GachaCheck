import type { ReactNode } from 'react'
import { cx } from './cx'

const TONES = {
  outline: 'rounded-full border border-line text-muted',
  neutral: 'rounded bg-line text-muted',
  accent: 'rounded bg-active text-accent',
} as const

/** A small label such as "Official", "Web event" or "Hidden". 12 px, the smallest text size the app uses. */
export function Tag({ tone = 'outline', className, children }: { tone?: keyof typeof TONES; className?: string; children: ReactNode }) {
  return <span className={cx('inline-flex items-center px-1.5 text-xs leading-5 whitespace-nowrap', TONES[tone], className)}>{children}</span>
}
