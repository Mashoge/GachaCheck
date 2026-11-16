import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { ConfirmContext, type ConfirmAsk, type ConfirmOptions } from './confirm'

/** Renders the one confirmation dialog the app needs. Wrap the signed-in app in it. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const ask = useCallback<ConfirmAsk>((next) => {
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
