import type { ButtonHTMLAttributes } from 'react'
import { buttonClass, type ButtonSize, type ButtonVariant } from './buttonStyles'
import { cx } from './cx'

export type { ButtonSize, ButtonVariant } from './buttonStyles'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Fill the width of the container */
  full?: boolean
  /** Square button holding only an icon; give it an aria-label */
  icon?: boolean
}

/** A button in one of the app's five styles. Defaults to type="button" so it never submits a form by accident. */
export function Button({ variant, size, full, icon, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cx(buttonClass({ variant, size, full, icon }), className)} {...rest} />
}
