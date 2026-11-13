import type { ReactNode } from 'react'
import { cx } from './cx'

/** A status line. "error" is announced to screen readers as soon as it appears. */
export function Notice({ tone = 'info', size = 'sm', className, children }: { tone?: 'info' | 'error'; size?: 'sm' | 'md'; className?: string; children: ReactNode }) {
  return (
    <p role={tone === 'error' ? 'alert' : undefined} className={cx(tone === 'error' ? 'text-urgent' : 'text-muted', size === 'sm' && 'text-sm', className)}>
      {children}
    </p>
  )
}

/** "Loading…" while a page fetches; announced politely. */
export function Loading({ children = 'Loading…' }: { children?: ReactNode }) {
  return <p role="status" className="text-muted">{children}</p>
}
