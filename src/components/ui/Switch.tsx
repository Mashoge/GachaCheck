import { cx } from './cx'

/** An on/off switch. Read out as a switch with its label and state. */
export function Switch({ label, on, onChange, disabled }: { label: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx('relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-50', on ? 'border-accent bg-accent' : 'border-edge bg-raised')}
    >
      <span
        aria-hidden="true"
        className={cx('absolute top-1/2 size-5 -translate-y-1/2 rounded-full transition-all', on ? 'left-6 bg-on-accent' : 'left-0.5 bg-muted')}
      />
    </button>
  )
}
