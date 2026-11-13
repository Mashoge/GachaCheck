import type { ComponentPropsWithoutRef, ElementType } from 'react'
import { cx } from './cx'

type CardProps = ComponentPropsWithoutRef<'div'> & {
  /** The element to render: a section, article, form, list item... */
  as?: ElementType
  /** md = p-4 (dense lists), lg = p-5 (page sections) */
  padding?: 'none' | 'md' | 'lg'
  /** urgent = an orange border, for overdue or stale items */
  tone?: 'default' | 'urgent'
}

/** The rounded surface panel used across the app. */
export function Card({ as: Tag = 'div', padding = 'lg', tone = 'default', className, ...rest }: CardProps) {
  return (
    <Tag
      className={cx(
        'rounded-2xl border bg-surface',
        tone === 'urgent' ? 'border-urgent' : 'border-line',
        padding === 'md' ? 'p-4' : padding === 'lg' ? 'p-5' : '',
        className,
      )}
      {...rest}
    />
  )
}
