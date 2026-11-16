import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'link' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent font-semibold text-on-accent hover:bg-accent/90',
  secondary: 'border border-edge font-semibold text-muted hover:border-muted hover:text-ink',
  quiet: 'text-muted hover:text-ink',
  link: 'font-semibold text-accent hover:underline',
  danger: 'border border-urgent/70 font-semibold text-urgent hover:bg-urgent/10',
}

// Two heights for everything except the sign-in button. Link buttons keep slim side padding.
const SIZES: Record<ButtonSize, string> = { sm: 'min-h-9 rounded-lg text-xs', md: 'min-h-10 rounded-lg text-sm', lg: 'h-11 rounded-xl text-base' }
const PADDING: Record<ButtonSize, string> = { sm: 'px-3', md: 'px-3', lg: 'px-4' }

/** The classes of a button, for elements that must look like one (e.g. a router Link). */
export function buttonClass({ variant = 'secondary', size = 'md', full = false, icon = false }: { variant?: ButtonVariant; size?: ButtonSize; full?: boolean; icon?: boolean } = {}) {
  return cx(
    'inline-flex items-center justify-center gap-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    icon ? (size === 'sm' ? 'size-9' : 'size-10') : variant === 'link' ? 'px-1' : PADDING[size],
    full && 'w-full',
  )
}
