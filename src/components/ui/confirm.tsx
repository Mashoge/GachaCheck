import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'

export type ConfirmOptions = {
  title: string
  message?: ReactNode
  /** The confirming button's text, e.g. "Delete" */
  confirmLabel?: string
  cancelLabel?: string
  /** A destructive action: the confirming button is styled as a warning */
  danger?: boolean
}

type Ask = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Ask | null>(null)

/** Renders the one confirmation dialog the app needs. Wrap the signed-in app in it. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const ask = useCallback<Ask>((next) => {
    resolver.current?.(false) // a second question cancels the first
    setOptions(next)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const answer = (ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setOptions(null)
  }

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Dialog
        open={options !== null}
        onClose={() => answer(false)}
        title={options?.title ?? ''}
        actions={
          <>
            {/* Cancel comes first, so it has focus when the dialog opens: Enter never deletes by accident */}
            <Button variant="quiet" onClick={() => answer(false)} autoFocus>
              {options?.cancelLabel ?? 'Cancel'}
            </Button>
            <Button variant={options?.danger ? 'danger' : 'primary'} onClick={() => answer(true)}>
              {options?.confirmLabel ?? 'OK'}
            </Button>
          </>
        }
      >
        {options?.message}
      </Dialog>
    </ConfirmContext.Provider>
  )
}

/**
 * Asks a yes/no question in an in-app dialog instead of the browser's confirm box.
 *   const confirm = useConfirm()
 *   if (!(await confirm({ title: 'Delete Genshin?', confirmLabel: 'Delete', danger: true }))) return
 */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext)
  if (!ask) throw new Error('useConfirm needs a <ConfirmProvider> above it')
  return ask
}
