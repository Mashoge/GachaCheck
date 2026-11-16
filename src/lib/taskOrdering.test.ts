import { describe, expect, it } from 'vitest'
import { moveTaskToIndex, moveTaskWithinGroup, nextCustomTaskSortOrder, nextTaskSortOrder } from './taskOrdering'

describe('nextTaskSortOrder', () => {
  it('appends after the greatest active preset or custom task', () => {
    expect(nextTaskSortOrder([
      { sort_order: 2, archived: false },
      { sort_order: 1000, archived: false },
      { sort_order: 7, archived: false },
    ])).toBe(1001)
  })

  it('ignores archived tasks', () => {
    expect(nextTaskSortOrder([
      { sort_order: 5, archived: false },
      { sort_order: 1000, archived: true },
    ])).toBe(6)
  })

  it('starts at zero when there are no active tasks', () => {
    expect(nextTaskSortOrder([{ sort_order: 12, archived: true }])).toBe(0)
  })
})


describe('nextCustomTaskSortOrder', () => {
  it('keeps custom tasks after ordinary preset sort positions', () => {
    expect(nextCustomTaskSortOrder([{ sort_order: 16, archived: false }])).toBe(1000)
  })

  it('appends after existing custom tasks', () => {
    expect(nextCustomTaskSortOrder([
      { sort_order: 1000, archived: false },
      { sort_order: 1001, archived: false },
    ])).toBe(1002)
  })
})


describe('moveTaskToIndex', () => {
  const ids = ['first', 'middle', 'last']

  it('moves a task from the start to the end of its group', () => {
    expect(moveTaskToIndex(ids, 0, 2)).toEqual(['middle', 'last', 'first'])
  })

  it('moves a task from the end to the middle of its group', () => {
    expect(moveTaskToIndex(ids, 2, 1)).toEqual(['first', 'last', 'middle'])
  })

  it('returns an unchanged copy when the indexes are equal', () => {
    expect(moveTaskToIndex(ids, 1, 1)).toEqual(ids)
  })

  it('does not mutate the original list', () => {
    moveTaskToIndex(ids, 0, 2)
    expect(ids).toEqual(['first', 'middle', 'last'])
  })

  it('returns an unchanged copy for invalid indexes', () => {
    expect(moveTaskToIndex(ids, -1, 2)).toEqual(ids)
    expect(moveTaskToIndex(ids, 0, 3)).toEqual(ids)
    expect(moveTaskToIndex(ids, 0.5, 1)).toEqual(ids)
  })
})


describe('moveTaskWithinGroup', () => {
  it('does not allow a task to move into another reset group', () => {
    expect(moveTaskWithinGroup(['a', 'b'], 0, 1, 'daily', 'weekly')).toBeNull()
  })

  it('moves a task when its source and destination groups match', () => {
    expect(moveTaskWithinGroup(['a', 'b', 'c'], 0, 2, 'daily', 'daily')).toEqual(['b', 'c', 'a'])
  })
})
