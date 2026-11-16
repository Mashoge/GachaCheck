import { describe, expect, it } from 'vitest'
import { bulkUndoReducer, BULK_UNDO_WINDOW_MS, type BulkUndoState } from './bulkUndo'

const empty: BulkUndoState = {}

describe('shared bulk undo state', () => {
  it('keeps independent undo batches for different games', () => {
    const genshin = bulkUndoReducer(empty, { type: 'begin', gameId: 'g', operationId: 'g-1', taskCount: 2, promptMeterId: null, now: 1_000 })
    const both = bulkUndoReducer(genshin, { type: 'begin', gameId: 'w', operationId: 'w-1', taskCount: 3, promptMeterId: null, now: 1_000 })

    expect(Object.keys(both)).toEqual(['g', 'w'])
    expect(both.g.status).toBe('saving')
    expect(both.w.status).toBe('saving')
  })

  it('stores only the exact completion IDs returned by successful inserts', () => {
    const saving = bulkUndoReducer(empty, { type: 'begin', gameId: 'g', operationId: 'g-1', taskCount: 2, promptMeterId: null, now: 1_000 })
    const ready = bulkUndoReducer(saving, {
      type: 'complete',
      gameId: 'g',
      operationId: 'g-1',
      entries: [
        { taskId: 'daily-a', completionId: 'completion-a' },
        { taskId: 'daily-b', completionId: '' },
      ],
    })

    expect(ready.g.status).toBe('ready')
    expect(ready.g.entries).toEqual([{ taskId: 'daily-a', completionId: 'completion-a' }])
  })

  it('ignores a stale async completion after a newer bulk operation starts', () => {
    const first = bulkUndoReducer(empty, { type: 'begin', gameId: 'g', operationId: 'old', taskCount: 1, promptMeterId: null, now: 1_000 })
    const second = bulkUndoReducer(first, { type: 'begin', gameId: 'g', operationId: 'new', taskCount: 2, promptMeterId: null, now: 2_000 })
    const stale = bulkUndoReducer(second, {
      type: 'complete',
      gameId: 'g',
      operationId: 'old',
      entries: [{ taskId: 'daily', completionId: 'old-row' }],
    })

    expect(stale).toBe(second)
    expect(stale.g.operationId).toBe('new')
  })

  it('expires undo at the original 60-second deadline', () => {
    const saving = bulkUndoReducer(empty, { type: 'begin', gameId: 'g', operationId: 'g-1', taskCount: 1, promptMeterId: null, now: 1_000 })
    const beforeExpiry = bulkUndoReducer(saving, { type: 'expire', now: 1_000 + BULK_UNDO_WINDOW_MS - 1 })
    const atExpiry = bulkUndoReducer(beforeExpiry, { type: 'expire', now: 1_000 + BULK_UNDO_WINDOW_MS })

    expect(beforeExpiry.g).toBeDefined()
    expect(atExpiry.g).toBeUndefined()
  })

  it('keeps the stamina prompt with the batch until it is explicitly dismissed', () => {
    const saving = bulkUndoReducer(empty, { type: 'begin', gameId: 'g', operationId: 'g-1', taskCount: 2, promptMeterId: 'meter-1', now: 1_000 })
    const ready = bulkUndoReducer(saving, {
      type: 'complete',
      gameId: 'g',
      operationId: 'g-1',
      entries: [{ taskId: 'daily-a', completionId: 'completion-a' }],
    })
    expect(ready.g.promptVisible).toBe(true)
    expect(ready.g.promptMeterId).toBe('meter-1')

    const dismissed = bulkUndoReducer(ready, { type: 'dismissPrompt', gameId: 'g', operationId: 'g-1' })
    expect(dismissed.g.promptVisible).toBe(false)
    expect(dismissed.g.entries).toEqual(ready.g.entries)
  })

  it('does not let an old dismiss action clear a newer batch', () => {
    const first = bulkUndoReducer(empty, { type: 'begin', gameId: 'g', operationId: 'old', taskCount: 1, promptMeterId: null, now: 1_000 })
    const second = bulkUndoReducer(first, { type: 'begin', gameId: 'g', operationId: 'new', taskCount: 1, promptMeterId: null, now: 2_000 })
    const unchanged = bulkUndoReducer(second, { type: 'dismiss', gameId: 'g', operationId: 'old' })

    expect(unchanged).toBe(second)
  })
})
