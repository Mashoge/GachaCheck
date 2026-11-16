import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { bulkUndoReducer, type BulkUndoEntry } from '../../lib/bulkUndo'
import { BulkUndoContext } from './BulkUndoContext'

export default function BulkUndoProvider({ children }: { children: ReactNode }) {
  const [batches, dispatch] = useReducer(bulkUndoReducer, {})
  const sequence = useRef(0)

  const begin = useCallback((gameId: string, taskCount: number, promptMeterId: string | null = null) => {
    const operationId = `${Date.now()}-${++sequence.current}`
    dispatch({ type: 'begin', gameId, operationId, taskCount, promptMeterId, now: Date.now() })
    return operationId
  }, [])

  const complete = useCallback((gameId: string, operationId: string, entries: BulkUndoEntry[]) => {
    dispatch({ type: 'complete', gameId, operationId, entries })
  }, [])

  const dismiss = useCallback((gameId: string, operationId?: string) => {
    dispatch({ type: 'dismiss', gameId, operationId })
  }, [])

  const dismissPrompt = useCallback((gameId: string, operationId?: string) => {
    dispatch({ type: 'dismissPrompt', gameId, operationId })
  }, [])

  useEffect(() => {
    const nextExpiry = Math.min(...Object.values(batches).map((batch) => batch.expiresAt))
    if (!Number.isFinite(nextExpiry)) return
    const timer = window.setTimeout(() => dispatch({ type: 'expire', now: Date.now() }), Math.max(0, nextExpiry - Date.now()))
    return () => window.clearTimeout(timer)
  }, [batches])

  const value = useMemo(() => ({ batches, begin, complete, dismiss, dismissPrompt }), [batches, begin, complete, dismiss, dismissPrompt])
  return <BulkUndoContext.Provider value={value}>{children}</BulkUndoContext.Provider>
}
