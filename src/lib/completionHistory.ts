export type CompletionRow = { id: string; task_id: string; completed_at: string }
type TaskResetInfo = { id: string; frequency: string; weekly_target: number | null; archived: boolean }

// Tasks with no reset period need their full completion history to determine whether a goal is done.
export function nonResettingTaskIds(games: readonly { tasks: readonly TaskResetInfo[] }[]): string[] {
  return games.flatMap((game) =>
    game.tasks.filter((task) => task.frequency === 'none' && task.weekly_target == null && !task.archived).map((task) => task.id),
  )
}

// Combine the recent window with lifetime rows for non-resetting tasks, avoiding duplicates where
// a recent goal completion appears in both queries.
export function groupCompletionRows(
  recentRows: readonly CompletionRow[],
  nonResettingRows: readonly CompletionRow[],
  nonResettingIds: ReadonlySet<string>,
): Map<string, { id: string; at: string }[]> {
  const rowsById = new Map<string, CompletionRow>()
  for (const row of recentRows) rowsById.set(row.id, row)
  for (const row of nonResettingRows) {
    if (nonResettingIds.has(row.task_id)) rowsById.set(row.id, row)
  }

  const completions = new Map<string, { id: string; at: string }[]>()
  for (const row of rowsById.values()) {
    const list = completions.get(row.task_id) ?? []
    list.push({ id: row.id, at: row.completed_at })
    completions.set(row.task_id, list)
  }
  for (const list of completions.values()) list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  return completions
}
