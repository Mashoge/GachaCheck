import { supabase } from './supabase'
import { findServer, type GamePreset } from '../data/presets'

export function fetchGames() {
  return supabase
    .from('games')
    .select('id, name, server, daily_reset_time, preset_id, tasks(id, title, frequency, archived), stamina_meters(id, name, cap, minutes_per_point, fills_when_full_of)')
    .order('sort_order')
    .order('created_at')
    .order('sort_order', { referencedTable: 'tasks' })
    .order('sort_order', { referencedTable: 'stamina_meters' })
}

export type GameSummary = NonNullable<Awaited<ReturnType<typeof fetchGames>>['data']>[number]

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
      preset_version: preset.version,
      sort_order: sortOrder,
    })
    .select('id')
    .single()
  if (error) throw error

  try {
    if (preset.tasks.length > 0) {
      const { error: taskError } = await supabase.from('tasks').insert(
        preset.tasks.map((task, index) => ({
          game_id: game.id,
          title: task.title,
          frequency: task.frequency,
          sort_order: index,
        })),
      )
      if (taskError) throw taskError
    }

    // Normal meters first, then overflow meters that point at them
    const idByKey = new Map<string, string>()
    const ordered = [...preset.meters].sort(
      (a, b) => Number(Boolean(a.fillsWhenFullOf)) - Number(Boolean(b.fillsWhenFullOf)),
    )
    for (const meter of ordered) {
      const parentId = meter.fillsWhenFullOf ? idByKey.get(meter.fillsWhenFullOf) : undefined
      const { data: row, error: meterError } = await supabase
        .from('stamina_meters')
        .insert({
          game_id: game.id,
          name: meter.name,
          cap: meter.cap,
          minutes_per_point: meter.minutesPerPoint,
          sort_order: preset.meters.indexOf(meter),
          fills_when_full_of: parentId ?? null,
        })
        .select('id')
        .single()
      if (meterError) throw meterError
      idByKey.set(meter.key, row.id)
    }
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
    .update({
      server: server.id,
      timezone: server.timezone,
      daily_reset_time: preset.dailyResetTime,
      weekly_reset_day: preset.weeklyResetDay,
    })
    .eq('id', gameId)
  if (error) throw error
}

export async function deleteGame(id: string) {
  const { error } = await supabase.from('games').delete().eq('id', id)
  if (error) throw error
}