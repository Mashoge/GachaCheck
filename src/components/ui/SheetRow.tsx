import type { ReactNode } from 'react'
import { cx } from './cx'

/**
 * One row of a settings sheet (THM-9): a spaced label on the left, its settings on the right, rows
 * split by hairlines. On a phone the label sits above. Used on the Games and Reminders pages.
 */
export function SheetRow({ label, level = 3, id, className, children }: {
  label: ReactNode
  level?: 2 | 3 | 4
  id?: string
  className?: string
  children: ReactNode
}) {
  const Heading = `h${level}` as const
  return (
    <div className={cx('grid gap-x-4 gap-y-2 border-t border-line px-4 py-3 first:border-t-0 sm:grid-cols-[120px_minmax(0,1fr)] sm:px-5', className)}>
      <Heading id={id} className="gc-label sm:pt-1.5">{label}</Heading>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
