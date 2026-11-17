import { describe, expect, it } from 'vitest'
import { cycleEndOnServer, endgameCycleUpdates, type CatalogCycle, type CycleGame } from '../../supabase/functions/_shared/endgameCycles.ts'

const at = (iso: string) => new Date(iso)
const NOW = at('2026-11-18T12:00:00+08:00')

// WuWa Patch Notes print the Endstate Matrix end in UTC+8
const cycle = (ends_local: string, extra: Partial<CatalogCycle> = {}): CatalogCycle => ({
  game: 'wuwa', server_scope: 'all', task_preset_key: 'endstate', ends_local, time_basis: 'fixed_offset', utc_offset_minutes: 480, ...extra,
})

const wuwa = (cycle_ends_at: string | null, extra: Partial<CycleGame> = {}): CycleGame => ({
  id: 'g-ww', preset_id: 'wuwa', server: 'sea', timezone: 'Etc/GMT-8',
  tasks: [
    { id: 't-endstate', preset_key: 'endstate', category: 'endgame', frequency: 'dated', cycle_ends_at },
    { id: 't-tower', preset_key: 'tower', category: 'endgame', frequency: 'interval', cycle_ends_at: null },
  ],
  ...extra,
})

describe('cycleEndOnServer', () => {
  it('converts a UTC+8 time to the game server clock', () => {
    expect(cycleEndOnServer(cycle('2026-12-22T03:59'), 'Etc/GMT-8')).toBe('2026-12-22T03:59')
    expect(cycleEndOnServer(cycle('2026-12-22T03:59:00'), 'America/New_York')).toBe('2026-12-21T14:59')
  })

  it('keeps a server-time date as printed', () => {
    expect(cycleEndOnServer(cycle('2026-12-22 04:00', { time_basis: 'server_local', utc_offset_minutes: null }), 'America/New_York')).toBe('2026-12-22T04:00')
  })

  it('gives up on an unreadable time or a missing offset', () => {
    expect(cycleEndOnServer(cycle('soon'), 'Etc/GMT-8')).toBeNull()
    expect(cycleEndOnServer(cycle('2026-12-22T03:59', { utc_offset_minutes: null }), 'Etc/GMT-8')).toBeNull()
  })
})

describe('endgame cycle dates from the catalog (EVT-10)', () => {
  it('fills in the date when the old one has passed, starting the new cycle where the old one ended', () => {
    // The preset date (Nov 12) is over, so the task says "Dates not set yet"
    expect(endgameCycleUpdates([cycle('2026-12-22T03:59')], [wuwa('2026-11-12T04:00')], NOW)).toEqual([
      { gameId: 'g-ww', taskId: 't-endstate', presetKey: 'endstate', cycle_ends_at: '2026-12-22T03:59', cycle_anchor: '2026-11-12' },
    ])
  })

  it('fills in a task that never had a date, leaving its start as it is', () => {
    const [u] = endgameCycleUpdates([cycle('2026-12-22T03:59')], [wuwa(null)], NOW)
    expect(u).toMatchObject({ cycle_ends_at: '2026-12-22T03:59', cycle_anchor: null })
  })

  it('never changes a running cycle, including a date set by hand', () => {
    expect(endgameCycleUpdates([cycle('2026-12-22T03:59')], [wuwa('2026-11-26T04:00')], NOW)).toEqual([])
  })

  it('picks the next cycle to end, not a later one', () => {
    const later = cycle('2027-01-19T03:59')
    const next = cycle('2026-12-22T03:59')
    expect(endgameCycleUpdates([later, next], [wuwa('2026-11-12T04:00')], NOW)[0].cycle_ends_at).toBe('2026-12-22T03:59')
  })

  it('ignores cycles that already ended, and dates not later than the old one', () => {
    expect(endgameCycleUpdates([cycle('2026-11-10T03:59')], [wuwa('2026-11-12T04:00')], NOW)).toEqual([])
    expect(endgameCycleUpdates([cycle('2026-11-12T04:00')], [wuwa(null)], NOW)).toEqual([])
  })

  it('matches by game, task and server', () => {
    const otherGame = cycle('2026-12-22T03:59', { game: 'nte' })
    const otherTask = cycle('2026-12-22T03:59', { task_preset_key: 'whimpering' })
    const otherServer = cycle('2026-12-22T03:59', { server_scope: 'america' })
    expect(endgameCycleUpdates([otherGame, otherTask, otherServer], [wuwa(null)], NOW)).toEqual([])
    const thisServer = cycle('2026-12-22T03:59', { server_scope: 'sea' })
    expect(endgameCycleUpdates([thisServer], [wuwa(null)], NOW)).toHaveLength(1)
  })

  it('leaves interval-based endgame (Tower of Adversity) and hand-made tasks alone', () => {
    const tower = cycle('2026-12-22T03:59', { task_preset_key: 'tower' })
    expect(endgameCycleUpdates([tower], [wuwa(null)], NOW)).toEqual([])
    const custom = wuwa(null, { tasks: [{ id: 't-mine', preset_key: null, category: 'endgame', frequency: 'dated', cycle_ends_at: null }] })
    expect(endgameCycleUpdates([cycle('2026-12-22T03:59')], [custom], NOW)).toEqual([])
  })

  it('works on a server in another time zone', () => {
    const america = wuwa('2026-11-12T04:00', { server: 'america', timezone: 'America/New_York' })
    expect(endgameCycleUpdates([cycle('2026-12-22T03:59')], [america], NOW)[0].cycle_ends_at).toBe('2026-12-21T14:59')
  })
})
