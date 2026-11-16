import { createContext, useContext, type ReactNode } from 'react'

export type ConfirmOptions = {
  title: string
  message?: ReactNode
  /** The confirming button's text, e.g. "Delete" */
  confirmLabel?: string
  cancelLabel?: string
  /** A destructive action: the confirming button is styled as a warning */
  danger?: boolean
}

export type ConfirmAsk = (options: ConfirmOptions) => Promise<boolean>

export const ConfirmContext = createContext<ConfirmAsk | null>(null)

/**
 * Asks a yes/no question in an in-app dialog instead of the browser's confirm box.
 *   const confirm = useConfirm()
 *   if (!(await confirm({ title: 'Delete Genshin?', confirmLabel: 'Delete', danger: true }))) return
 */
export function useConfirm(): ConfirmAsk {
  const ask = useContext(ConfirmContext)
  if (!ask) throw new Error('useConfirm needs a <ConfirmProvider> above it')
  return ask
}
