import { cloneElement, isValidElement, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cx } from './cx'

// Control borders use the "edge" colour (3:1 against the surfaces) so a field's outline is visible.
const CONTROL = 'rounded-lg border border-edge bg-page px-3 text-ink placeholder:text-muted [color-scheme:dark] transition-colors focus:border-accent disabled:opacity-60'
const HEIGHT = { sm: 'min-h-9 text-sm', md: 'min-h-10 text-sm', lg: 'h-11 rounded-xl text-base' } as const

type Size = keyof typeof HEIGHT

/** The classes of a text-like control, for the rare element the components below do not cover. */
export const controlClass = (size: Size = 'md') => cx(CONTROL, HEIGHT[size])

export function Input({ size = 'md', className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: Size }) {
  return <input className={cx(controlClass(size), className)} {...rest} />
}

export function Select({ size = 'md', className, ...rest }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: Size }) {
  return <select className={cx(controlClass(size), className)} {...rest} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(CONTROL, 'py-2 text-sm', className)} {...rest} />
}

type FieldProps = {
  /** The control's id; the label points at it */
  id: string
  label: ReactNode
  /** Shown under the control and read out with it */
  hint?: ReactNode
  /** Shown in orange and announced; also marks the control invalid */
  error?: ReactNode
  /** Hide the label visually (it is still read out) */
  hideLabel?: boolean
  /** Label size: sm = text-xs (dense forms), md = text-sm */
  labelSize?: 'sm' | 'md'
  className?: string
  children: ReactElement
}

/** A label, one control, and optional hint and error text, linked for screen readers. */
export function Field({ id, label, hint, error, hideLabel, labelSize = 'md', className, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  const control = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })
    : children

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : cx('text-muted', labelSize === 'sm' ? 'text-xs' : 'text-sm')}>
        {label}
      </label>
      {control}
      {hint && <p id={hintId} className="text-xs text-muted">{hint}</p>}
      {error && <p id={errorId} role="alert" className="text-xs text-urgent">{error}</p>}
    </div>
  )
}
