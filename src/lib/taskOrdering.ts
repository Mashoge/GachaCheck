/** Move one task to an absolute position in the same sortable group. */
export function moveTaskToIndex(taskIds: readonly string[], fromIndex: number, toIndex: number): string[] {
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    fromIndex >= taskIds.length ||
    toIndex < 0 ||
    toIndex >= taskIds.length
  ) return [...taskIds]

  if (fromIndex === toIndex) return [...taskIds]
  const next = [...taskIds]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

/** Reorder is only valid when the drag starts and ends within the same task group. */
export function moveTaskWithinGroup(
  taskIds: readonly string[],
  fromIndex: number,
  toIndex: number,
  sourceGroup: string | number | symbol | null | undefined,
  targetGroup: string | number | symbol | null | undefined,
): string[] | null {
  if (sourceGroup == null || sourceGroup !== targetGroup) return null
  return moveTaskToIndex(taskIds, fromIndex, toIndex)
}

/** Choose an unused order after every active task, including player-created tasks. */
export function nextTaskSortOrder(tasks: readonly { sort_order: number; archived: boolean }[]): number {
  return Math.max(-1, ...tasks.filter((task) => !task.archived).map((task) => task.sort_order)) + 1
}


/** Keep new player-created tasks after the preset-order range until the player reorders a group. */
export function nextCustomTaskSortOrder(tasks: readonly { sort_order: number; archived: boolean }[]): number {
  return Math.max(1000, nextTaskSortOrder(tasks))
}
