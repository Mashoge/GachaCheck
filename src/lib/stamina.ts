export * from '../../supabase/functions/_shared/stamina.ts'

/** How far a meter is above its cap (refills can push it over). 0 when at or below the cap. */
export const overCapBy = (meter: { value: number; cap: number }) => Math.max(0, meter.value - meter.cap)
