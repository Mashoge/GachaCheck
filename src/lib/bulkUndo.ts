export type BulkUndoEntry = {
  taskId: string
  completionId: string
}

export type BulkUndoBatch = {
  operationId: string
  taskCount: number
  entries: BulkUndoEntry[]
  status: 'saving' | 'ready'
  expiresAt: number
  promptMeterId: string | null
  promptVisible: boolean
}

export type BulkUndoState = Record<string, BulkUndoBatch>

export type BulkUndoAction =
  | { type: 'begin'; gameId: string; operationId: string; taskCount: number; promptMeterId: string | null; now: number }
  | { type: 'complete'; gameId: string; operationId: string; entries: BulkUndoEntry[] }
  | { type: 'dismiss'; gameId: string; operationId?: string }
  | { type: 'dismissPrompt'; gameId: string; operationId?: string }
  | { type: 'expire'; now: number }

export const BULK_UNDO_WINDOW_MS = 60_000

export function bulkUndoReducer(state: BulkUndoState, action: BulkUndoAction): BulkUndoState {
  switch (action.type) {
    case 'begin':
      return {
        ...state,
        [action.gameId]: {
          operationId: action.operationId,
          taskCount: action.taskCount,
          entries: [],
          status: 'saving',
          expiresAt: action.now + BULK_UNDO_WINDOW_MS,
          promptMeterId: action.promptMeterId,
          promptVisible: action.promptMeterId !== null,
        },
      }
    case 'complete': {
      const current = state[action.gameId]
      if (!current || current.operationId !== action.operationId) return state
      const entries = action.entries.filter((entry) => entry.completionId.length > 0)
      if (entries.length === 0) {
        const next = { ...state }
        delete next[action.gameId]
        return next
      }
      return { ...state, [action.gameId]: { ...current, entries, status: 'ready' } }
    }
    case 'dismiss': {
      const current = state[action.gameId]
      if (!current || (action.operationId && current.operationId !== action.operationId)) return state
      const next = { ...state }
      delete next[action.gameId]
      return next
    }
    case 'dismissPrompt': {
      const current = state[action.gameId]
      if (!current || (action.operationId && current.operationId !== action.operationId) || !current.promptVisible) return state
      return { ...state, [action.gameId]: { ...current, promptVisible: false } }
    }
    case 'expire': {
      let changed = false
      const next: BulkUndoState = {}
      for (const [gameId, batch] of Object.entries(state)) {
        if (batch.expiresAt > action.now) next[gameId] = batch
        else changed = true
      }
      return changed ? next : state
    }
  }
}
