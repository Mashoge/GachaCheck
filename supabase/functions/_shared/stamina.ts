// Live stamina from the last recorded value. Overflow meters (e.g. Waveplate Crystals)
// only fill while their parent meter is full.

export type MeterRow = {
  id: string
  name: string
  cap: number
  minutes_per_point: number
  fills_when_full_of: string | null
  current_value: number
  value_recorded_at: string
  spend_presets?: number[]
  ping_at?: number | null // SUP-3: ping when the meter reaches this value; null = 90% of the cap
}

export type MeterState = {
  id: string
  name: string
  cap: number
  value: number
  full: boolean
  isOverflow: boolean
  fullAt: Date | null // when it reaches cap (null if full, or if it depends on a parent that isn't full yet)
  nextPointAt: Date | null
}

const MIN = 60_000

function plain(m: MeterRow, now: number) {
  const recorded = new Date(m.value_recorded_at).getTime()
  const step = m.minutes_per_point * MIN
  const base = Math.max(0, m.current_value)
  // Above cap (e.g. after a refill): no regen until it drops below cap again
  if (base >= m.cap) return { value: base, full: true, fullAt: null, fullSince: recorded, nextPointAt: null }
  const gained = Math.max(0, Math.floor((now - recorded) / step))
  const value = Math.min(m.cap, base + gained)
  const fullAtMs = recorded + (m.cap - base) * step
  return {
    value,
    full: value >= m.cap,
    fullAt: value >= m.cap ? null : new Date(fullAtMs),
    fullSince: value >= m.cap ? fullAtMs : null,
    nextPointAt: value >= m.cap ? null : new Date(recorded + (gained + 1) * step),
  }
}

export function meterStates(meters: MeterRow[], nowDate: Date): MeterState[] {
  const now = nowDate.getTime()
  const byId = new Map(meters.map((m) => [m.id, m]))

  return meters.map((m) => {
    const parent = m.fills_when_full_of ? byId.get(m.fills_when_full_of) : undefined
    if (!parent) {
      const s = plain(m, now)
      return { id: m.id, name: m.name, cap: m.cap, value: s.value, full: s.full, isOverflow: false, fullAt: s.fullAt, nextPointAt: s.nextPointAt }
    }

    const p = plain(parent, now)
    const recorded = new Date(m.value_recorded_at).getTime()
    const base = Math.min(m.cap, m.current_value)
    const step = m.minutes_per_point * MIN
    const fillFrom = p.fullSince === null ? null : Math.max(recorded, p.fullSince)
    const gained = fillFrom === null ? 0 : Math.max(0, Math.floor((now - fillFrom) / step))
    const value = Math.min(m.cap, base + gained)
    const full = value >= m.cap
    return {
      id: m.id, name: m.name, cap: m.cap, value, full, isOverflow: true,
      fullAt: full || fillFrom === null ? null : new Date(fillFrom + (m.cap - base) * step),
      nextPointAt: full || fillFrom === null ? null : new Date(fillFrom + (gained + 1) * step),
    }
  })
}

// ---- SUP-3: when a meter counts as "nearly full" (Discord ping and Today's Needs attention) ----

export const STAMINA_WARN_RATIO = 0.9 // the default: within 10% of the cap

/** The value at which a meter is pinged: the player's own threshold, else 90% of the cap. Never above the cap. */
export function pingThreshold(meter: { cap: number; ping_at?: number | null }): number {
  if (meter.ping_at != null && meter.ping_at > 0) return Math.min(meter.ping_at, meter.cap)
  return Math.ceil(meter.cap * STAMINA_WARN_RATIO)
}
