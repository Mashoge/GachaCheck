import { supabase } from './supabase'
import type { TablesInsert } from './database.types'
import { findPreset, findServer, type GamePreset, type PresetTask } from '../data/presets'

export function fetchGames() {
  return supabase
    .from('games')
    .select('id, name, server, timezone, daily_reset_time, weekly_reset_day, preset_id, preset_version, tasks(id, title, frequency, category, hidden, optional, archived, preset_key, note, weekly_target, monthly_day, cycle_anchor, cycle_days, cycle_ends_at, due_at), stamina_meters(id, name, cap, minutes_per_point, fills_when_full_of, current_value, value_recorded_at, preset_key, spend_presets)')
    .order('created_at')
    .order('sort_order', { referencedTable: 'tasks' })
    .order('sort_order', { referencedTable: 'stamina_meters' })
}

export type GameSummary = NonNullable<Awaited<ReturnType<typeof fetchGames>>['data']>[number]

function taskFields(task: PresetTask, sortOrder: number) {
  return {
    title: task.title,
    frequency: task.rule,
    category: task.category ?? 'routine',
    optional: task.optional ?? false,
    note: task.note ?? null,
    monthly_day: task.monthlyDay ?? null,
    cycle_anchor: task.cycleAnchor ?? null,
    cycle_days: task.cycleDays ?? null,
    cycle_ends_at: task.cycleEndsAt ?? null,
    sort_order: sortOrder,
    // Only overwrite the target when the preset defines one; otherwise keep the player's own
    ...(task.weeklyTarget !== undefined ? { weekly_target: task.weeklyTarget } : {}),
  }
}

// End dates are written in server time, e.g. '2026-11-12T04:00'. Returns the later of the two.
// Used so a sync never replaces an end date you entered with an older one (or with nothing).
export function laterEndDate(a: string | null, b: string | null) {
  const minute = (v: string) => v.replace(' ', 'T').slice(0, 16)
  if (!a) return b
  if (!b) return a
  return minute(a) >= minute(b) ? a : b
}

/** Bring one game in line with its preset. Never touches hidden flags or custom tasks. */
export async function syncGame(gameId: string, preset: GamePreset, serverId: string | null) {
  const server = findServer(preset, serverId) ?? findServer(preset, preset.defaultServer)
  if (!server) throw new Error(`No servers defined for ${preset.name}`)

  const { error: gameError } = await supabase
    .from('games')
    .update({
      name: preset.name,
      server: server.id,
      timezone: server.timezone,
      daily_reset_time: preset.dailyResetTime,
      weekly_reset_day: preset.weeklyResetDay,
    })
    .eq('id', gameId)
  if (gameError) throw gameError

  // ---- Tasks (only rows that came from the preset) ----
  const { data: existingTasks, error: tasksError } = await supabase
    .from('tasks')
    .select('id, preset_key, archived, cycle_ends_at, cycle_anchor')
    .eq('game_id', gameId)
    .not('preset_key', 'is', null)
  if (tasksError) throw tasksError

  const taskByKey = new Map(existingTasks.map((t) => [t.preset_key ?? '', t]))
  const newTasks: TablesInsert<'tasks'>[] = []
  for (const [index, task] of preset.tasks.entries()) {
    const fields = taskFields(task, index)
    const existing = taskByKey.get(task.key)
    if (existing) {
      // Keep an end date entered in the app unless the preset has a later one
      const cycle_ends_at = laterEndDate(existing.cycle_ends_at, fields.cycle_ends_at)
      // ...and the start day saved with it (modes on a fixed schedule take theirs from the preset)
      const cycle_anchor = fields.cycle_anchor ?? existing.cycle_anchor
      const { error } = await supabase.from('tasks').update({ ...fields, cycle_ends_at, cycle_anchor, archived: false }).eq('id', existing.id)
      if (error) throw error
    } else {
      newTasks.push({ ...fields, game_id: gameId, preset_key: task.key, hidden: task.optional ?? false })
    }
  }
  if (newTasks.length > 0) {
    const { error } = await supabase.from('tasks').insert(newTasks)
    if (error) throw error
  }

  // Preset tasks that were removed from the file are archived (history kept)
  const presetTaskKeys = new Set(preset.tasks.map((t) => t.key))
  const retired = existingTasks
    .filter((t) => !t.archived && !presetTaskKeys.has(t.preset_key ?? ''))
    .map((t) => t.id)
  if (retired.length > 0) {
    const { error } = await supabase.from('tasks').update({ archived: true }).in('id', retired)
    if (error) throw error
  }

  // ---- Stamina meters ----
  const { data: existingMeters, error: metersError } = await supabase
    .from('stamina_meters')
    .select('id, preset_key')
    .eq('game_id', gameId)
  if (metersError) throw metersError

  const meterIdByKey = new Map(
    existingMeters.filter((m) => m.preset_key).map((m) => [m.preset_key ?? '', m.id]),
  )
  // Normal meters first, so overflow meters can point at them
  const ordered = [...preset.meters].sort(
    (a, b) => Number(Boolean(a.fillsWhenFullOf)) - Number(Boolean(b.fillsWhenFullOf)),
  )
  for (const meter of ordered) {
    const fields = {
      name: meter.name,
      cap: meter.cap,
      minutes_per_point: meter.minutesPerPoint,
      sort_order: preset.meters.indexOf(meter),
      fills_when_full_of: meter.fillsWhenFullOf ? (meterIdByKey.get(meter.fillsWhenFullOf) ?? null) : null,
    }
    const existingId = meterIdByKey.get(meter.key)
    if (existingId) {
      const { error } = await supabase.from('stamina_meters').update(fields).eq('id', existingId)
      if (error) throw error
    } else {
      const { data: row, error } = await supabase
        .from('stamina_meters')
        .insert({ ...fields, game_id: gameId, preset_key: meter.key })
        .select('id')
        .single()
      if (error) throw error
      meterIdByKey.set(meter.key, row.id)
    }
  }

  // Meters no longer in the preset are removed
  const presetMeterKeys = new Set(preset.meters.map((m) => m.key))
  const staleMeters = existingMeters
    .filter((m) => !m.preset_key || !presetMeterKeys.has(m.preset_key))
    .map((m) => m.id)
  if (staleMeters.length > 0) {
    const { error } = await supabase.from('stamina_meters').delete().in('id', staleMeters)
    if (error) throw error
  }

  // Mark as synced last, so a failed sync is retried on the next load
  const { error: versionError } = await supabase
    .from('games')
    .update({ preset_version: preset.version })
    .eq('id', gameId)
  if (versionError) throw versionError
}

/** Sync every game whose preset has a newer version. Returns true if anything changed. */
export async function syncOutdatedGames(games: GameSummary[]) {
  let changed = false
  for (const game of games) {
    const preset = findPreset(game.preset_id)
    if (preset && (game.preset_version ?? 0) < preset.version) {
      await syncGame(game.id, preset, game.server)
      changed = true
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

export async function addGameFromPreset(preset: GamePreset, serverId: string, sortOrder: number) {
  const server = findServer(preset, serverId)
  if (!server) throw new Error(`Unknown server "${serverId}" for ${preset.name}`)

  const { data: game, error } = await supabase
    .from('games')
    .insert({
      name: preset.name,
      server: server.id,
      timezone: server.timezone,
      daily_reset_time: preset.dailyResetTime,
      weekly_reset_day: preset.weeklyResetDay,
      preset_id: preset.id,
      preset_version: 0,
      sort_order: sortOrder,
    })
    .select('id')
    .single()
  if (error) throw error

  try {
    await syncGame(game.id, preset, server.id)
  } catch (err) {
    // Remove the half-created game so you can simply try again
    await supabase.from('games').delete().eq('id', game.id)
    throw err
  }
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
 * End date of the current cycle for modes without a fixed schedule, in server time ('YYYY-MM-DDTHH:MM').
 * `previousEnd` is the end of the cycle that just finished, if there was one: the new cycle starts there,
 * so a clear from the old cycle isn't counted again.
 */
export async function setCycleEndsAt(taskId: string, endsAt: string, previousEnd: string | null) {
  const { error } = await supabase
    .from('tasks')
    .update({ cycle_ends_at: endsAt, ...(previousEnd ? { cycle_anchor: previousEnd.slice(0, 10) } : {}) })
    .eq('id', taskId)
  if (error) throw error
}

export type CustomTaskKind = 'daily' | 'weekly' | 'goal'

export async function addCustomTask(
  gameId: string,
  input: { title: string; kind: CustomTaskKind; dueAt: string | null },
) {
  const isGoal = input.kind === 'goal'
  const { error } = await supabase.from('tasks').insert({
    game_id: gameId,
    title: input.title,
    frequency: isGoal ? 'none' : input.kind,
    category: isGoal ? 'goal' : 'routine',
    due_at: isGoal ? input.dueAt : null,
    sort_order: 1000, // after preset tasks
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