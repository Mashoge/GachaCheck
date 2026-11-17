// Hidden events: listing them again so they can be restored, and noticing when a new event
// would match one. Pure functions only, so the rules can be tested without a database.
//
// Two of these mirror rules that live in the database. Keep them in step:
//   nameKey      ↔ public.catalog_name_key        (migration 20261113030000_catalog_ingest.sql)
//   duplicateOf  ↔ the "cand" and "dup" steps of the user_events view
//                  (latest: migration 20261113060000_catalog_versions.sql)

import { toInstant } from './eventTime'

/** An official event the user hid, as read from catalog_events. Times are the clock times the publisher printed. */
export type HiddenCatalogRow = {
  id: string
  game: string
  server_scope: string
  kind: string
  name: string
  ends_local: string | null
  time_basis: string
  utc_offset_minutes: number | null
  status: string
}

/** One of the user's own imported events that they hid. */
export type HiddenOwnRow = { id: string; game_id: string; name: string; ends_at: string }

export type HiddenRows = { catalog: HiddenCatalogRow[]; own: HiddenOwnRow[] }

export type HiddenEvent = {
  key: string // unique in the list: 'cat:<catalog id>' or the own event's id
  origin: 'catalog' | 'own'
  id: string // catalog_events.id for official events, events.id for your own
  game_id: string
  name: string
  ends_at: string
  kind: 'event' | 'web_event'
}

export type HiddenGame = { id: string; preset_id: string | null; server: string | null; timezone: string }

/** Same result as public.catalog_name_key: lower case, apostrophes dropped, anything else not a-z or 0-9 becomes one space. */
export function nameKey(name: string): string {
  const trimSpaces = (s: string) => s.replace(/^ +| +$/g, '') // Postgres trim() removes spaces only
  const latin = trimSpaces(
    name
      .normalize('NFKC')
      .toLowerCase()
      .replace(/['’`]/g, '')
      .replace(/[^a-z0-9]+/g, ' '),
  )
  return (latin || trimSpaces(name).toLowerCase()).slice(0, 120)
}

/**
 * A catalog clock time ("2026-11-19T04:59:00") → the real moment, the way the user_events view converts it:
 * server_local uses the game's server clock, fixed_offset uses the printed UTC offset. Minute precision.
 */
export function catalogInstant(local: string, basis: string, offsetMinutes: number | null, timezone: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(local)
  if (!m) return null
  if (basis === 'fixed_offset') {
    if (offsetMinutes === null) return null
    const asUtc = Date.parse(`${m[1]}T${m[2]}:00Z`)
    if (Number.isNaN(asUtc)) return null
    return new Date(asUtc - offsetMinutes * 60_000).toISOString()
  }
  return toInstant(m[1], m[2], timezone)
}

/**
 * The hidden events worth listing: not ended yet, for a game the user has, and only the kinds the
 * Events list shows (web events only while they are switched on). Soonest end first.
 */
export function toHiddenEvents(rows: HiddenRows, games: HiddenGame[], showWeb: boolean, now: Date): HiddenEvent[] {
  const out: HiddenEvent[] = []

  for (const row of rows.catalog) {
    if (row.status !== 'confirmed' || !row.ends_local) continue
    if (row.kind !== 'event' && row.kind !== 'web_event') continue
    if (row.kind === 'web_event' && !showWeb) continue
    const game = games.find((g) => g.preset_id === row.game && (row.server_scope === 'all' || row.server_scope === g.server))
    if (!game) continue
    const ends = catalogInstant(row.ends_local, row.time_basis, row.utc_offset_minutes, game.timezone)
    if (!ends) continue
    out.push({ key: `cat:${row.id}`, origin: 'catalog', id: row.id, game_id: game.id, name: row.name, ends_at: ends, kind: row.kind })
  }

  for (const row of rows.own) {
    if (!games.some((g) => g.id === row.game_id)) continue
    out.push({ key: row.id, origin: 'own', id: row.id, game_id: row.game_id, name: row.name, ends_at: new Date(row.ends_at).toISOString(), kind: 'event' })
  }

  return out
    .filter((e) => new Date(e.ends_at) > now)
    .sort((a, b) => a.ends_at.localeCompare(b.ends_at) || a.name.localeCompare(b.name))
}

/** An event that was just hidden, in the shape the restore needs. Null when a catalog event has lost its link. */
export function hiddenFromEvent(event: {
  id: string
  origin: 'own' | 'catalog'
  catalog_event_id: string | null
  game_id: string
  name: string
  ends_at: string
  kind: 'event' | 'web_event'
}): HiddenEvent | null {
  if (event.origin === 'catalog') {
    if (!event.catalog_event_id) return null
    return { key: `cat:${event.catalog_event_id}`, origin: 'catalog', id: event.catalog_event_id, game_id: event.game_id, name: event.name, ends_at: event.ends_at, kind: event.kind }
  }
  return { key: event.id, origin: 'own', id: event.id, game_id: event.game_id, name: event.name, ends_at: event.ends_at, kind: 'event' }
}

/** An official event an own event could be a copy of. */
export type CatalogCandidate = { catalogId: string; game_id: string; name: string; ends_at: string }

/**
 * Which official events an own event counts as a duplicate of, by the same rule as the user_events view.
 * A duplicate is never listed, so a new own event that matches here does not appear.
 *   Same game, ends within a day, and the names are equal, or one is the start of the other on a
 *   whole-word boundary (shorter name at least 4 characters). An exact match always counts;
 *   a partial match only when there is no exact one and it is the only candidate.
 * Pass every official event, hidden or not: the view counts candidates across all of them.
 */
export function duplicateOf(own: { game_id: string; name: string; ends_at: string }, catalog: CatalogCandidate[]): string[] {
  const key = nameKey(own.name)
  const end = Date.parse(own.ends_at)
  const candidates = catalog
    .filter((c) => c.game_id === own.game_id && Math.abs(Date.parse(c.ends_at) - end) <= 86_400_000)
    .map((c) => ({ id: c.catalogId, key: nameKey(c.name) }))
    .filter((c) => c.key === key || (key.length >= 4 && c.key.startsWith(`${key} `)) || (c.key.length >= 4 && key.startsWith(`${c.key} `)))

  const exact = candidates.filter((c) => c.key === key)
  if (exact.length > 0) return exact.map((c) => c.id)
  return candidates.length === 1 ? [candidates[0].id] : []
}

/** The hidden official event a new own event would be swallowed by, if any. */
export function hiddenMatch(own: { game_id: string; name: string; ends_at: string }, visibleCatalog: CatalogCandidate[], hidden: HiddenEvent[]): HiddenEvent | null {
  const hiddenCatalog = hidden.filter((h) => h.origin === 'catalog')
  const all = [...visibleCatalog, ...hiddenCatalog.map((h) => ({ catalogId: h.id, game_id: h.game_id, name: h.name, ends_at: h.ends_at }))]
  const ids = duplicateOf(own, all)
  return hiddenCatalog.find((h) => ids.includes(h.id)) ?? null
}
