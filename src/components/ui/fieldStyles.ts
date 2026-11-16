import { cx } from './cx'

// Control borders use the "edge" colour (3:1 against the surfaces) so a field's outline is visible.
const CONTROL = 'rounded-lg border border-edge bg-page px-3 text-ink placeholder:text-muted [color-scheme:dark] transition-colors focus:border-accent disabled:opacity-60'
const HEIGHT = { sm: 'min-h-9 text-sm', md: 'min-h-10 text-sm', lg: 'h-11 rounded-xl text-base' } as const

export type ControlSize = keyof typeof HEIGHT

export const controlBaseClass = CONTROL

/** The classes of a text-like control, for the rare element the components below do not cover. */
export const controlClass = (size: ControlSize = 'md') => cx(CONTROL, HEIGHT[size])
