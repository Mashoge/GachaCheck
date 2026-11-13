import type { ReactNode } from 'react'
import { cx } from './cx'

/** A page's one h1. */
export function PageTitle({ size = 'lg', className, children }: { size?: 'md' | 'lg'; className?: string; children: ReactNode }) {
  return <h1 className={cx('font-display font-bold', size === 'lg' ? 'text-3xl' : 'text-2xl', className)}>{children}</h1>
}
