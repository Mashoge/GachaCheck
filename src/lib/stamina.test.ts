import { describe, expect, it } from 'vitest'
import { meterStates, type MeterRow } from './stamina'

const MIN = 60_000
const T0 = new Date('2026-11-09T06:00:00+08:00').getTime()
const after = (minutes: number) => new Date(T0 + minutes * MIN)
const iso = (minutes: number) => after(minutes).toISOString()

const resin = (value: number, recordedMin = 0): MeterRow => ({
  id: 'resin', name: 'Original Resin', cap: 200, minutes_per_point: 8,
  fills_when_full_of: null, current_value: value, value_recorded_at: iso(recordedMin),
})

const waveplates = (value: number, recordedMin = 0): MeterRow => ({
  id: 'wp', name: 'Waveplates', cap: 240, minutes_per_point: 6,
  fills_when_full_of: null, current_value: value, value_recorded_at: iso(recordedMin),
})

const crystals = (value: number, recordedMin = 0): MeterRow => ({
  id: 'cr', name: 'Waveplate Crystals', cap: 480, minutes_per_point: 12,
  fills_when_full_of: 'wp', current_value: value, value_recorded_at: iso(recordedMin),
})

const one = (m: MeterRow, nowMin: number) => meterStates([m], after(nowMin))[0]

describe('normal meter (Original Resin: 200 cap, 1 per 8 min)', () => {
  it('does not gain a point before 8 minutes', () => {
    expect(one(resin(6), 7).value).toBe(6)
  })

  it('gains 1 point every 8 minutes', () => {
    expect(one(resin(6), 8).value).toBe(7)
    expect(one(resin(6), 80).value).toBe(16)
  })

  it('shows when the next point and the full meter arrive', () => {
    const s = one(resin(6), 10)
    expect(s.nextPointAt).toEqual(after(16))
    expect(s.fullAt).toEqual(after(194 * 8)) // 194 points to go
    expect(s.full).toBe(false)
  })

  it('stops at the cap', () => {
    const s = one(resin(6), 10_000)
    expect(s.value).toBe(200)
    expect(s.full).toBe(true)
    expect(s.fullAt).toBeNull()
    expect(s.nextPointAt).toBeNull()
  })

  it('above the cap (after a refill) it stays put and does not regenerate', () => {
    const s = one(resin(230), 500)
    expect(s.value).toBe(230)
    expect(s.full).toBe(true)
    expect(s.fullAt).toBeNull()
  })

  it('treats a negative value as 0', () => {
    expect(one(resin(-5), 0).value).toBe(0)
  })
})

describe('overflow meter (Waveplate Crystals fill only while Waveplates is full)', () => {
  it('does not fill while Waveplates is below the cap', () => {
    // Waveplates 230/240 → full after 60 min
    const [, cr] = meterStates([waveplates(230), crystals(10)], after(59))
    expect(cr.value).toBe(10)
    expect(cr.isOverflow).toBe(true)
    expect(cr.fullAt).toBeNull()
    expect(cr.nextPointAt).toBeNull()
  })

  it('starts filling once Waveplates is full: 1 per 12 min', () => {
    const [wp, cr] = meterStates([waveplates(230), crystals(10)], after(60 + 24))
    expect(wp.full).toBe(true)
    expect(cr.value).toBe(12)
    expect(cr.nextPointAt).toEqual(after(60 + 36))
    expect(cr.fullAt).toEqual(after(60 + 470 * 12))
  })

  it('if Crystals was set after Waveplates filled, it counts from that moment', () => {
    // Waveplates already full at 0; Crystals recorded at 100
    const [, cr] = meterStates([waveplates(240), crystals(50, 100)], after(100 + 36))
    expect(cr.value).toBe(53)
  })

  it('also fills while Waveplates is above its cap', () => {
    const [, cr] = meterStates([waveplates(300), crystals(0)], after(120))
    expect(cr.value).toBe(10)
  })

  it('stops at its own cap', () => {
    const [, cr] = meterStates([waveplates(240), crystals(470)], after(100_000))
    expect(cr.value).toBe(480)
    expect(cr.full).toBe(true)
    expect(cr.fullAt).toBeNull()
  })

  it('works whichever order the meters come in', () => {
    const [cr] = meterStates([crystals(10), waveplates(230)], after(60 + 24))
    expect(cr.value).toBe(12)
  })
})