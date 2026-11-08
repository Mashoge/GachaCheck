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
  const base = Math.min(m.cap, m.current_value)
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