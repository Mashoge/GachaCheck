import { supabase } from './supabase'
import { nextCustomTaskSortOrder } from './taskOrdering'
import { findPreset, findServer, type GamePreset, type PresetServer } from '../data/presets'

export function fetchGames() {
  return supabase
    .from('games')
    .select('id, name, server, timezone, daily_reset_time, weekly_reset_day, preset_id, preset_version, task_order_customized, skipped_until, tasks(id, title, frequency, category, hidden, optional, archived, preset_key, note, weekly_target, monthly_day, cycle_anchor, cycle_days, cycle_ends_at, due_at), stamina_meters(id, name, cap, minutes_per_point, fills_when_full_of, current_value, value_recorded_at, preset_key, spend_presets, ping_at)')
    .order('created_at')
    .order('sort_order', { referencedTable: 'tasks' })
    .order('sort_order', { referencedTable: 'stamina_meters' })
}

export type GameSummary = NonNullable<Awaited<ReturnType<typeof fetchGames>>['data']>[number]

/**
 * The preset as the database functions read it (ARC-1), set to one server. Tasks and meters stay in
 * preset order, which is the order they get unless the player reordered their tasks.
 */
export function presetPayload(preset: GamePreset, server: PresetServer) {
  return {
    preset_id: preset.id,
    version: preset.version,
    name: preset.name,
    server: server.id,
    timezone: server.timezone,
    daily_reset_time: preset.dailyResetTime,
    weekly_reset_day: preset.weeklyResetDay,
    tasks: preset.tasks.map((task) => ({
      key: task.key,
      title: task.title,
      frequency: task.rule,
      category: task.category ?? 'routine',
      optional: task.optional ?? false,
      note: task.note ?? null,
      monthly_day: task.monthlyDay ?? null,
      cycle_anchor: task.cycleAnchor ?? null,
      cycle_days: task.cycleDays ?? null,
      cycle_ends_at: task.cycleEndsAt ?? null,
      // Only sent when the preset defines one, so the player's own target is kept otherwise
      ...(task.weeklyTarget !== undefined ? { weekly_target: task.weeklyTarget } : {}),
    })),
    meters: preset.meters.map((meter) => ({
      key: meter.key,
      name: meter.name,
      cap: meter.cap,
      minutes_per_point: meter.minutesPerPoint,
      fills_when_full_of_key: meter.fillsWhenFullOf ?? null,
    })),
  }
}

function presetServer(preset: GamePreset, serverId: string | null) {
  const server = findServer(preset, serverId) ?? findServer(preset, preset.defaultServer)
  if (!server) throw new Error(`No servers defined for ${preset.name}`)
  return server
}

/**
 * Bring one game in line with its preset, all or nothing (database function sync_game_preset).
 * Never touches hidden flags, your own tasks, your task order, later end dates or meter settings.
 * Returns false when the game was already on this version (e.g. another tab synced it first).
 */
export async function syncGame(gameId: string, preset: GamePreset, serverId: string | null) {
  const { data, error } = await supabase.rpc('sync_game_preset', {
    p_game_id: gameId,
    p_preset: presetPayload(preset, presetServer(preset, serverId)),
  })
  if (error) throw error
  return data
}

/** Sync every game whose preset has a newer version. Returns true if anything changed. */
export async function syncOutdatedGames(games: GameSummary[]) {
  let changed = false
  for (const game of games) {
    const preset = findPreset(game.preset_id)
    if (preset && (game.preset_version ?? 0) < preset.version) {
      if (await syncGame(game.id, preset, game.server)) changed = true
    }
  }
  return changed
}

/** Fetch games, syncing any outdated ones first. */
export async function loadGames() {
  const first = await fetchGames()
  if (first.error) throw first.error
  if (!(await syncOutdatedGames(first.data))) return first.data
  const second = await fetchGames()
  if (second.error) throw second.error
  return second.data
}

/** Add a game with its tasks and meters in one go: if anything fails, nothing is left behind. */
export async function addGameFromPreset(preset: GamePreset, serverId: string, sortOrder: number) {
  const server = findServer(preset, serverId)
  if (!server) throw new Error(`Unknown server "${serverId}" for ${preset.name}`)
  const { error } = await supabase.rpc('add_game_from_preset', {
    p_preset: presetPayload(preset, server),
    p_sort_order: sortOrder,
  })
  if (error) throw error
}

export async function changeServer(gameId: string, preset: GamePreset, serverId: string) {
  const server = findServer(preset, serverId)
  if (!server) throw new Error(`Unknown server "${serverId}" for ${preset.name}`)
  const { error } = await supabase
    .from('games')
    .update({ server: server.id, timezone: server.timezone })
    .eq('id', gameId)
  if (error) throw error
}

/** SUP-3: the stamina value a meter is pinged at (null = 90% of the cap). Preset sync never changes it. */
export async function setPingAt(meterId: string, pingAt: number | null) {
  const { error } = await supabase.from('stamina_meters').update({ ping_at: pingAt }).eq('id', meterId)
  if (error) throw error
}

export async function deleteGame(id: string) {
  const { error } = await supabase.from('games').delete().eq('id', id)
  if (error) throw error
}

export async function setTaskHidden(taskId: string, hidden: boolean) {
  const { error } = await supabase.from('tasks').update({ hidden }).eq('id', taskId)
  if (error) throw error
}

export async function setWeeklyTarget(taskId: string, target: number | null) {
  const { error } = await supabase.from('tasks').update({ weekly_target: target }).eq('id', taskId)
  if (error) throw error
}

/**
 * Dates of the current cycle for modes without a fixed schedule, in server time.
 * `endsAt` is 'YYYY-MM-DDTHH:MM'. `startDay` ('YYYY-MM-DD') is when the cycle opens: before then the mode shows
 * "Starts in …", and only clears from that day on count. Null keeps the start already saved.
 */
export async function setCycleDates(taskId: string, endsAt: string, startDay: string | null) {
  const { error } = await supabase
    .from('tasks')
    .update({ cycle_ends_at: endsAt, ...(startDay ? { cycle_anchor: startDay } : {}) })
    .eq('id', taskId)
  if (error) throw error
}

export type CustomTaskKind = 'daily' | 'weekly' | 'goal'

export async function addCustomTask(
  gameId: string,
  input: { title: string; kind: CustomTaskKind; dueAt: string | null },
) {
  const isGoal = input.kind === 'goal'
  const { data: existingTasks, error: tasksError } = await supabase
    .from('tasks')
    .select('sort_order, archived')
    .eq('game_id', gameId)
  if (tasksError) throw tasksError

  const { error } = await supabase.from('tasks').insert({
    game_id: gameId,
    title: input.title,
    frequency: isGoal ? 'none' : input.kind,
    category: isGoal ? 'goal' : 'routine',
    due_at: isGoal ? input.dueAt : null,
    sort_order: nextCustomTaskSortOrder(existingTasks),
  })
  if (error) throw error
}

/** Only your own tasks can be removed; they're archived so history stays. */
export async function removeCustomTask(taskId: string) {
  const { error } = await supabase
    .from('tasks')
    .update({ archived: true })
    .eq('id', taskId)
    .is('preset_key', null)
  if (error) throw error
}

/** Restore a previously removed custom task without discarding its completion history. */
export async function restoreCustomTask(taskId: string) {
  const { error } = await supabase
    .from('tasks')
    .update({ archived: false })
    .eq('id', taskId)
    .eq('archived', true)
    .is('preset_key', null)
  if (error) throw error
}

/** Persist one complete task group's order atomically through a database function. */
export async function reorderGameTasks(gameId: string, taskIds: readonly string[]) {
  if (taskIds.length < 2) return
  const { error } = await supabase.rpc('reorder_game_tasks', {
    p_game_id: gameId,
    p_task_ids: [...taskIds],
  })
  if (error) throw error
}
