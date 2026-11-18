import { useState, type ReactNode } from 'react'
import { cx } from './cx'

// THM-12: tags as an icon plus short text. The icon says what kind of tag it is, the legend on each page
// explains the icons, hovering shows the full phrase, tapping an icon-only tag spells out its name, and a
// screen reader always hears the full phrase. Our own icons, drawn on a 24-unit grid.
export type TagIconName = 'full' | 'official' | 'web' | 'auto' | 'imported' | 'mine' | 'optional' | 'hidden' | 'done' | 'overflow'

const TAG_LABELS: Record<TagIconName, string> = {
  full: 'Full',
  official: 'Official',
  web: 'Web event',
  auto: 'Auto-added',
  imported: 'Imported',
  mine: 'Added by you',
  optional: 'Optional',
  hidden: 'Hidden',
  done: 'Done',
  overflow: 'Overflow from',
}

const PATHS: Record<TagIconName, ReactNode> = {
  full: <path d="M13.2 2.5 4.8 13.6h6.1l-1.1 7.9 8.4-11.1h-6.1z" fill="currentColor" stroke="none" />,
  official: <path d="m12 3.2 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.6l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" fill="currentColor" stroke="none" />,
  web: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5z" /></>,
  auto: <><path d="M19.5 10.5A7.7 7.7 0 0 0 5.8 7.3L4.5 8.8" /><path d="M4.5 4.5v4.3h4.3" /><path d="M4.5 13.5a7.7 7.7 0 0 0 13.7 3.2l1.3-1.5" /><path d="M19.5 19.5v-4.3h-4.3" /></>,
  imported: <><path d="M12 3.5v10.5M7.8 9.8 12 14l4.2-4.2" /><path d="M4 15v4.5h16V15" /></>,
  mine: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></>,
  optional: <circle cx="12" cy="12" r="8" strokeDasharray="3.4 3" />,
  hidden: <><path d="m3.5 3.5 17 17" /><path d="M10.4 5.2A9 9 0 0 1 12 5c6 0 9.5 7 9.5 7a16 16 0 0 1-2.9 3.8M6.7 6.7A16 16 0 0 0 2.5 12s3.5 7 9.5 7a9.4 9.4 0 0 0 4.3-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  done: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  overflow: <><path d="M6 4v7.5A3.5 3.5 0 0 0 9.5 15H19" /><path d="m15 11 4 4-4 4" /></>,
}

export function TagIcon({ name, size = 13 }: { name: TagIconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {PATHS[name]}
    </svg>
  )
}

type IconTagProps = {
  icon: TagIconName
  /** Short text beside the icon (a time, a count, a name). Without it, the tag is the icon alone. */
  text?: string
  /** The full phrase, for screen readers and hovering. Defaults to the icon's name plus the text. */
  say?: string
  tone?: 'urgent' | 'rest'
  className?: string
}

export function IconTag({ icon, text, say, tone, className }: IconTagProps) {
  const [open, setOpen] = useState(false)
  const label = TAG_LABELS[icon]
  const full = say ?? (text ? `${label} ${text}` : label)
  return (
    <span
      className={cx('gc-tag gc-itag', !text && 'gc-itag-solo', className)}
      data-tone={tone}
      data-open={open ? '' : undefined}
      title={full}
      // An icon-only tag spells out its name when tapped (a phone has no hover)
      onClick={text ? undefined : () => setOpen((o) => !o)}
    >
      <TagIcon name={icon} />
      {text ? (
        <>
          <span className="sr-only">{full}</span>
          <span aria-hidden="true">{text}</span>
        </>
      ) : (
        <span className="gc-itag-label">{full}</span>
      )}
    </span>
  )
}

/**
 * The key to the icons used on a page: each icon with its name. Hidden from screen readers, which
 * already hear each tag's full phrase.
 */
export function TagLegend({ icons, className }: { icons: TagIconName[]; className?: string }) {
  return (
    <p aria-hidden="true" className={cx('gc-legend', className)}>
      {icons.map((name) => (
        <span key={name}>
          <TagIcon name={name} size={12} />
          {TAG_LABELS[name]}
        </span>
      ))}
    </p>
  )
}
