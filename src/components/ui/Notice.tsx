import { useReportLoading } from '../../lib/pageLoading'
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

/**
 * "Loading…" while a page fetches; announced politely. Use it for a whole page only: while it is on
 * screen the page counts as loading, and AppShell covers the wait with its loading screen (THM-10).
 */
export function Loading({ children = 'Loading…' }: { children?: ReactNode }) {
  useReportLoading()
  // Read out by screen readers; shown only where the loading screen is off (gc-loading-text in index.css)
  return <p role="status" className="gc-loading-text text-muted">{children}</p>
}
