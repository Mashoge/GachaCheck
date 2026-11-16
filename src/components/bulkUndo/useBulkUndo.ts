import { useContext } from 'react'
import { BulkUndoContext } from './BulkUndoContext'

export function useBulkUndo() {
  const context = useContext(BulkUndoContext)
  if (!context) throw new Error('useBulkUndo must be used inside BulkUndoProvider')
  return context
}
