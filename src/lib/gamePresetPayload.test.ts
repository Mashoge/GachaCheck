import { describe, expect, it } from 'vitest'
import { presetPayload } from './games'
import { PRESETS, findServer, type GamePreset } from '../data/presets'

// ARC-1: what the app sends to sync_game_preset / add_game_from_preset. The database trusts this
// shape, so check it against every real preset.

const minimal: GamePreset = {
  id: 'test', version: 3, lastChecked: '2026-11-18', name: 'Test Game', taskExample: 'x',
  dailyResetTime: '04:00', weeklyResetDay: 1, defaultServer: 'asia',
  servers: [{ id: 'asia', label: 'Asia', timezone: 'Etc/GMT-8' }],
  meters: [
    { key: 'crystals', name: 'Crystals', cap: 480, minutesPerPoint: 12, fillsWhenFullOf: 'plates' },
    { key: 'plates', name: 'Plates', cap: 240, minutesPerPoint: 6 },
  ],
  tasks: [
    { key: 'daily', title: 'Dailies', rule: 'daily' },
    { key: 'weekly', title: 'Weekly boss', rule: 'weekly', weeklyTarget: 3, optional: true, note: 'n' },
  ],
}

describe('presetPayload (ARC-1)', () => {
  it('carries the server, resets and version', () => {
    const p = presetPayload(minimal, minimal.servers[0])
    expect(p).toMatchObject({
      preset_id: 'test', version: 3, name: 'Test Game', server: 'asia', timezone: 'Etc/GMT-8',
      daily_reset_time: '04:00', weekly_reset_day: 1,
    })
  })

  it('fills task defaults and only sends weekly_target when the preset has one', () => {
    const [daily, weekly] = presetPayload(minimal, minimal.servers[0]).tasks
    expect(daily).toEqual({
      key: 'daily', title: 'Dailies', frequency: 'daily', category: 'routine', optional: false, note: null,
      monthly_day: null, cycle_anchor: null, cycle_days: null, cycle_ends_at: null,
    })
    expect('weekly_target' in daily).toBe(false)
    expect(JSON.parse(JSON.stringify(daily))).not.toHaveProperty('weekly_target')
    expect(weekly).toMatchObject({ weekly_target: 3, optional: true, note: 'n' })
  })

  it('keeps preset order and links overflow meters by key', () => {
    const p = presetPayload(minimal, minimal.servers[0])
    expect(p.tasks.map((t) => t.key)).toEqual(['daily', 'weekly'])
    expect(p.meters).toEqual([
      { key: 'crystals', name: 'Crystals', cap: 480, minutes_per_point: 12, fills_when_full_of_key: 'plates' },
      { key: 'plates', name: 'Plates', cap: 240, minutes_per_point: 6, fills_when_full_of_key: null },
    ])
  })

  describe.each(PRESETS.map((preset) => [preset.id, preset] as const))('real preset %s', (_id, preset) => {
    const server = findServer(preset, preset.defaultServer)
    const p = presetPayload(preset, server!)

    it('has a default server and a version above 0 (a new game is saved at 0)', () => {
      expect(server).toBeTruthy()
      expect(p.version).toBeGreaterThan(0)
    })

    it('has unique, non-empty task and meter keys', () => {
      const taskKeys = p.tasks.map((t) => t.key)
      const meterKeys = p.meters.map((m) => m.key)
      expect(taskKeys.every(Boolean) && meterKeys.every(Boolean)).toBe(true)
      expect(new Set(taskKeys).size).toBe(taskKeys.length)
      expect(new Set(meterKeys).size).toBe(meterKeys.length)
    })

    it('only points overflow meters at another meter in the same preset', () => {
      const keys = new Set(p.meters.map((m) => m.key))
      for (const m of p.meters) {
        if (m.fills_when_full_of_key) {
          expect(keys.has(m.fills_when_full_of_key)).toBe(true)
          expect(m.fills_when_full_of_key).not.toBe(m.key)
        }
      }
    })

    it('fits the database checks', () => {
      for (const t of p.tasks) {
        expect(t.title.length).toBeGreaterThan(0)
        expect(t.title.length).toBeLessThanOrEqual(80)
        if (t.frequency === 'monthly') expect(t.monthly_day).not.toBeNull()
        if (t.frequency === 'interval') expect(t.cycle_anchor && t.cycle_days).toBeTruthy()
      }
      for (const m of p.meters) {
        expect(m.name.length).toBeLessThanOrEqual(40)
        expect(m.cap).toBeGreaterThan(0)
        expect(m.minutes_per_point).toBeGreaterThan(0)
      }
    })
  })
})
