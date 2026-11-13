// Checks a collector payload before anything reaches the database.
// Pure logic, shared by the "ingest" Edge Function and the tests.
//
// The rule is strict on purpose: one bad record rejects the whole request, so a collector bug
// shows up as a clear error instead of half a run being saved. Unknown fields are dropped.

export const LIMITS = { articles: 50, observationsPerArticle: 200, observations: 1000 } as const

const KINDS = ['event', 'web_event', 'banner', 'endgame_cycle'] as const
const ARTICLE_KINDS = ['patch_notes', 'maintenance', 'events_notice', 'banner_notice', 'event_preview', 'endgame_notice', 'feed', 'other'] as const
const BASES = ['server_local', 'fixed_offset'] as const
const START_RULES = ['exact', 'after_update', 'unknown'] as const

export type IngestObservation = {
  observed_key: string
  kind: (typeof KINDS)[number]
  version: string
  server_scope: string
  name: string
  occurrence_key: string
  starts_local: string | null // 'YYYY-MM-DDTHH:MM' as the publisher printed it
  ends_local: string | null
  time_basis: (typeof BASES)[number]
  utc_offset_minutes: number | null
  start_rule: (typeof START_RULES)[number]
  official_url: string | null
  task_preset_key: string | null
  raw_text: string | null
  trusted: boolean
}

export type IngestArticle = {
  external_id: string
  title: string
  url: string | null
  article_kind: (typeof ARTICLE_KINDS)[number]
  published_at: string | null // ISO instant with an offset
  content_hash: string | null
  complete: boolean // true = these are all the events in the article; missing ones get flagged
  // Optional: the version this article announces and when it goes live (the end of the update
  // maintenance). Gives "after update" events their start. Usually only on patch notes.
  version_release: { version: string; released_at: string } | null
  observations: IngestObservation[]
}

export type IngestPayload = { source: string; game: string; articles: IngestArticle[] }

export type IngestCheck = { ok: true; payload: IngestPayload } | { ok: false; errors: string[] }

const SLUG = /^[a-z0-9_]{1,40}$/
const GAME = /^[a-z0-9_-]{1,20}$/
const SCOPE = /^[a-z0-9_-]{1,20}$/
const OCCURRENCE = /^[a-z0-9:_-]{0,40}$/
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

// A real calendar time: '2026-02-30T04:00' is refused
function localTime(v: string): string | null {
  const m = LOCAL_TIME.exec(v)
  if (!m) return null
  const [, y, mo, d, h, mi, s = '00'] = m
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
  const same = date.getUTCFullYear() === +y && date.getUTCMonth() === +mo - 1 && date.getUTCDate() === +d && date.getUTCHours() === +h && +mi < 60 && +s < 60
  return same ? `${y}-${mo}-${d}T${h}:${mi}` : null
}

export function checkPayload(body: unknown): IngestCheck {
  const errors: string[] = []
  const fail = (path: string, why: string) => {
    if (errors.length < 50) errors.push(`${path}: ${why}`)
  }

  if (!isObject(body)) return { ok: false, errors: ['body: must be a JSON object'] }

  const source = typeof body.source === 'string' && SLUG.test(body.source) ? body.source : (fail('source', 'lowercase letters, digits and _ only'), '')
  const game = typeof body.game === 'string' && GAME.test(body.game) ? body.game : (fail('game', 'lowercase letters, digits, _ and - only'), '')

  if (!Array.isArray(body.articles) || body.articles.length === 0) return { ok: false, errors: [...errors, 'articles: must be a non-empty list'] }
  if (body.articles.length > LIMITS.articles) return { ok: false, errors: [...errors, `articles: at most ${LIMITS.articles} per request`] }

  const seenArticles = new Set<string>()
  let total = 0
  const articles: IngestArticle[] = []

  body.articles.forEach((a, i) => {
    const at = `articles[${i}]`
    if (!isObject(a)) return fail(at, 'must be an object')

    const external_id = typeof a.external_id === 'string' || typeof a.external_id === 'number' ? String(a.external_id).trim() : ''
    if (external_id.length < 1 || external_id.length > 80) fail(`${at}.external_id`, 'required, 1 to 80 characters')
    else if (seenArticles.has(external_id)) fail(`${at}.external_id`, 'listed twice in this request')
    seenArticles.add(external_id)

    const title = typeof a.title === 'string' ? clean(a.title) : ''
    if (title.length < 1 || title.length > 300) fail(`${at}.title`, 'required, 1 to 300 characters')

    const url = a.url == null ? null : typeof a.url === 'string' && a.url.startsWith('https://') && a.url.length <= 500 ? a.url : (fail(`${at}.url`, 'must start with https://'), null)
    const article_kind = a.article_kind == null ? 'other' : ARTICLE_KINDS.includes(a.article_kind as never) ? (a.article_kind as IngestArticle['article_kind']) : (fail(`${at}.article_kind`, `one of ${ARTICLE_KINDS.join(', ')}`), 'other')
    const published_at = a.published_at == null ? null : typeof a.published_at === 'string' && INSTANT.test(a.published_at) && !Number.isNaN(Date.parse(a.published_at)) ? a.published_at : (fail(`${at}.published_at`, 'an ISO time with an offset, e.g. 2026-11-12T10:00:00+08:00'), null)
    const content_hash = a.content_hash == null ? null : typeof a.content_hash === 'string' && a.content_hash.length <= 128 ? a.content_hash : (fail(`${at}.content_hash`, 'at most 128 characters'), null)
    const complete = a.complete === true

    let version_release: IngestArticle['version_release'] = null
    if (a.version_release != null) {
      const vr = a.version_release
      if (!isObject(vr)) fail(`${at}.version_release`, 'must be an object: { version, released_at }')
      else {
        const version = typeof vr.version === 'string' ? vr.version.trim() : ''
        if (version.length < 1 || version.length > 20) fail(`${at}.version_release.version`, 'required, 1 to 20 characters')
        const released_at = typeof vr.released_at === 'string' && INSTANT.test(vr.released_at) && !Number.isNaN(Date.parse(vr.released_at)) ? vr.released_at : ''
        if (!released_at) fail(`${at}.version_release.released_at`, 'an ISO time with an offset, e.g. 2026-11-11T11:00:00+08:00')
        if (version && released_at) version_release = { version, released_at }
      }
    }

    const list = a.observations == null ? [] : a.observations
    if (!Array.isArray(list)) return fail(`${at}.observations`, 'must be a list')
    if (list.length > LIMITS.observationsPerArticle) return fail(`${at}.observations`, `at most ${LIMITS.observationsPerArticle} per article`)
    total += list.length

    const seenKeys = new Set<string>()
    const observations: IngestObservation[] = []

    list.forEach((o, j) => {
      const ot = `${at}.observations[${j}]`
      if (!isObject(o)) return fail(ot, 'must be an object')

      const observed_key = typeof o.observed_key === 'string' ? o.observed_key.trim() : ''
      if (observed_key.length < 1 || observed_key.length > 200) fail(`${ot}.observed_key`, 'required, 1 to 200 characters')
      else if (seenKeys.has(observed_key)) fail(`${ot}.observed_key`, 'used twice in this article; merge the repeats first')
      seenKeys.add(observed_key)

      const kind = KINDS.includes(o.kind as never) ? (o.kind as IngestObservation['kind']) : (fail(`${ot}.kind`, `one of ${KINDS.join(', ')}`), 'event')
      const version = o.version == null ? '' : typeof o.version === 'string' && o.version.length <= 20 ? o.version.trim() : (fail(`${ot}.version`, 'at most 20 characters'), '')
      const server_scope = o.server_scope == null ? 'all' : typeof o.server_scope === 'string' && SCOPE.test(o.server_scope) ? o.server_scope : (fail(`${ot}.server_scope`, "'all' or a server id"), 'all')
      const name = typeof o.name === 'string' ? clean(o.name) : ''
      if (name.length < 1 || name.length > 120) fail(`${ot}.name`, 'required, 1 to 120 characters')
      const occurrence_key = o.occurrence_key == null ? '' : typeof o.occurrence_key === 'string' && OCCURRENCE.test(o.occurrence_key) ? o.occurrence_key : (fail(`${ot}.occurrence_key`, 'lowercase letters, digits, :, _ and - only, at most 40'), '')

      const time = (field: 'starts_local' | 'ends_local') => {
        const v = o[field]
        if (v == null) return null
        const t = typeof v === 'string' ? localTime(v) : null
        if (!t) fail(`${ot}.${field}`, "a real time written 'YYYY-MM-DDTHH:MM', with no offset")
        return t
      }
      const starts_local = time('starts_local')
      const ends_local = time('ends_local')
      if (starts_local && ends_local && ends_local <= starts_local) fail(`${ot}.ends_local`, 'must be after the start')

      const time_basis = o.time_basis == null ? 'server_local' : BASES.includes(o.time_basis as never) ? (o.time_basis as IngestObservation['time_basis']) : (fail(`${ot}.time_basis`, `one of ${BASES.join(', ')}`), 'server_local')
      const offset = o.utc_offset_minutes
      const utc_offset_minutes = offset == null ? null : Number.isInteger(offset) && (offset as number) >= -720 && (offset as number) <= 840 ? (offset as number) : (fail(`${ot}.utc_offset_minutes`, 'a whole number from -720 to 840'), null)
      if (time_basis === 'fixed_offset' && offset == null) fail(`${ot}.utc_offset_minutes`, "required when time_basis is 'fixed_offset'")
      if (time_basis === 'server_local' && utc_offset_minutes != null) fail(`${ot}.utc_offset_minutes`, "only allowed when time_basis is 'fixed_offset'")

      const start_rule = o.start_rule == null ? (starts_local ? 'exact' : 'unknown') : START_RULES.includes(o.start_rule as never) ? (o.start_rule as IngestObservation['start_rule']) : (fail(`${ot}.start_rule`, `one of ${START_RULES.join(', ')}`), 'unknown')
      if (start_rule === 'exact' && !starts_local) fail(`${ot}.starts_local`, "required when start_rule is 'exact'")

      const official_url = o.official_url == null ? null : typeof o.official_url === 'string' && o.official_url.startsWith('https://') && o.official_url.length <= 500 ? o.official_url : (fail(`${ot}.official_url`, 'must start with https://'), null)
      const task_preset_key = o.task_preset_key == null ? null : typeof o.task_preset_key === 'string' && SLUG.test(o.task_preset_key) ? o.task_preset_key : (fail(`${ot}.task_preset_key`, 'lowercase letters, digits and _ only'), null)
      if (kind === 'endgame_cycle' && !task_preset_key) fail(`${ot}.task_preset_key`, 'required for an endgame cycle')
      if (kind !== 'endgame_cycle' && task_preset_key) fail(`${ot}.task_preset_key`, 'only for endgame cycles')
      if (kind === 'endgame_cycle' && !occurrence_key) fail(`${ot}.occurrence_key`, 'required for an endgame cycle (a cycle number or its start date)')

      const raw_text = typeof o.raw_text === 'string' ? clean(o.raw_text).slice(0, 500) : null
      const trusted = o.trusted === true

      observations.push({
        observed_key, kind, version, server_scope, name, occurrence_key, starts_local, ends_local,
        time_basis, utc_offset_minutes, start_rule, official_url, task_preset_key, raw_text, trusted,
      })
    })

    articles.push({ external_id, title, url, article_kind, published_at, content_hash, complete, version_release, observations })
  })

  if (total > LIMITS.observations) fail('articles', `at most ${LIMITS.observations} observations per request`)
  return errors.length ? { ok: false, errors } : { ok: true, payload: { source, game, articles } }
}

// Compares two secrets without leaking how much of them matched
export function sameSecret(given: string | null, expected: string): boolean {
  if (!given || !expected) return false
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

export type BodyRead = { ok: true; text: string } | { ok: false; status: 413 | 400; error: string }

// Reads a request body but stops as soon as it passes maxBytes, so an oversized body
// is never held in memory in full. A Content-Length that is already too large is refused
// before anything is read.
export async function readBodyLimited(req: Request, maxBytes: number): Promise<BodyRead> {
  const tooLarge = { ok: false, status: 413, error: `Body is too large (${maxBytes} bytes at most)` } as const
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge
  if (!req.body) return { ok: false, status: 400, error: 'Body is empty' }

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => {})
      return tooLarge
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.byteLength
  }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { ok: false, status: 400, error: 'Body is not valid UTF-8' }
  }
}
