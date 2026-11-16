import { createContext } from 'react'
import type { BulkUndoEntry, BulkUndoState } from '../../lib/bulkUndo'

export type BulkUndoContextValue = {
  batches: BulkUndoState
  begin: (gameId: string, taskCount: number, promptMeterId?: string | null) => string
  complete: (gameId: string, operationId: string, entries: BulkUndoEntry[]) => void
  dismiss: (gameId: string, operationId?: string) => void
  dismissPrompt: (gameId: string, operationId?: string) => void
}

export const BulkUndoContext = createContext<BulkUndoContextValue | null>(null)
