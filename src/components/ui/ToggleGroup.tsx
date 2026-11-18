import { cx } from './cx'

export type ToggleOption<T extends string> = { id: T; label: string }

/**
 * A row of buttons where one is chosen (a filter, a view). Each is a toggle button
 * (aria-pressed), so a screen reader says which one is on.
 */
export function ToggleGroup<T extends string>({ label, options, value, onChange, shape = 'pill', className }: {
  label: string
  options: ToggleOption<T>[]
  value: T
  onChange: (id: T) => void
  /** pill = separate rounded chips; segmented = joined in one bar; slant = the slanted chips of THM-9 */
  shape?: 'pill' | 'segmented' | 'slant'
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cx(shape === 'segmented' ? 'flex gap-1 rounded-xl border border-line bg-surface p-1' : shape === 'slant' ? 'flex flex-wrap gap-2 pl-1' : 'flex flex-wrap gap-1.5', className)}>
      {options.map((o) => {
        const on = o.id === value
        if (shape === 'slant') {
          return (
            <button key={o.id} type="button" aria-pressed={on} onClick={() => onChange(o.id)} className="gc-chip">
              <span>{o.label}</span>
            </button>
          )
        }
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={cx(
              'min-h-9 px-3.5 text-sm font-medium transition-colors',
              shape === 'segmented' ? 'flex-1 rounded-lg md:flex-none' : 'rounded-full border',
              on ? (shape === 'segmented' ? 'bg-active text-accent' : 'border-accent bg-active text-accent') : shape === 'segmented' ? 'text-muted hover:text-ink' : 'border-edge text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
