import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cx } from './cx'

type DialogProps = {
  open: boolean
  /** Called when the dialog closes: Escape, a click on the backdrop, or a button that calls it */
  onClose: () => void
  title: ReactNode
  children?: ReactNode
  /** The buttons along the bottom */
  actions?: ReactNode
  className?: string
}

/**
 * A modal dialog built on the browser's own <dialog>. The browser keeps focus inside it,
 * closes it with Escape, dims the page behind, and puts focus back where it was afterwards.
 */
export function Dialog({ open, onClose, title, children, actions, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the dimmed area outside the panel closes it, like Escape
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className={cx(
        'gc-dialog m-auto w-[min(28rem,calc(100%-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink backdrop:bg-black/60',
        className,
      )}
    >
      <div className="flex flex-col gap-3 p-5">
        <h2 id={titleId} className="font-display text-lg font-semibold">{title}</h2>
        {children && <div className="text-sm text-muted">{children}</div>}
        {actions && <div className="mt-2 flex flex-wrap justify-end gap-2">{actions}</div>}
      </div>
    </dialog>
  )
}
