import { describe, expect, it } from 'vitest'
import { checkPayload, LIMITS, readBodyLimited, sameSecret } from '../../supabase/functions/_shared/ingest.ts'

// One article from the WuWa 3.8 Patch Notes, as the collector would send it
const observation = (over: Record<string, unknown> = {}) => ({
  observed_key: 'lahai-roi blocks turnabout',
  kind: 'event',
  version: '3.8',
  name: 'Lahai-Roi Blocks: Turnabout',
  starts_local: '2026-11-19T04:00',
  ends_local: '2026-12-03T03:59',
  time_basis: 'server_local',
  start_rule: 'exact',
  raw_text: '✦Duration: 2026-11-19 04:00 - 2026-12-03 03:59 (server time)',
  trusted: true,
  ...over,
})

const payload = (obs: unknown[] = [observation()], articleOver: Record<string, unknown> = {}) => ({
  source: 'wuwa_official_site',
  game: 'wuwa',
  articles: [
    {
      external_id: 5783,
      title: 'Patch Notes for Version 3.8: Lilies in a Dying Dream',
      url: 'https://wutheringwaves.kurogames.com/en/main/news/detail/5783',
      article_kind: 'patch_notes',
      published_at: '2026-11-12T10:00:00+08:00',
      content_hash: '48CF4518551DBF235796A664DFAD4816',
      complete: true,
      observations: obs,
      ...articleOver,
    },
  ],
})

const errorsOf = (body: unknown) => {
  const r = checkPayload(body)
  return r.ok ? [] : r.errors
}

describe('checkPayload', () => {
  it('accepts a normal Patch Notes article and fills in defaults', () => {
    const r = checkPayload(payload())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const a = r.payload.articles[0]
    expect(a.external_id).toBe('5783') // a number becomes text
    expect(a.observations[0]).toMatchObject({ server_scope: 'all', occurrence_key: '', utc_offset_minutes: null, official_url: null, task_preset_key: null })
  })

  it('drops fields it does not know', () => {
    const r = checkPayload({ ...payload([observation({ extra: 1 })]), unknown: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect('extra' in r.payload.articles[0].observations[0]).toBe(false)
  })

  it('accepts an update-time start with no start date', () => {
    expect(errorsOf(payload([observation({ starts_local: null, start_rule: 'after_update' })]))).toEqual([])
  })

  it('accepts a web event on a fixed UTC+8 clock', () => {
    expect(errorsOf(payload([observation({ kind: 'web_event', time_basis: 'fixed_offset', utc_offset_minutes: 480, official_url: 'https://example.com/event' })]))).toEqual([])
  })

  it('accepts an endgame cycle with its task key and occurrence', () => {
    expect(errorsOf(payload([observation({ kind: 'endgame_cycle', name: 'Endstate Matrix', task_preset_key: 'endstate', occurrence_key: 'cycle-2', starts_local: null, start_rule: 'unknown', time_basis: 'fixed_offset', utc_offset_minutes: 480 })]))).toEqual([])
  })

  it('refuses an endgame cycle without a task key or occurrence', () => {
    const errs = errorsOf(payload([observation({ kind: 'endgame_cycle' })]))
    expect(errs.some((e) => e.includes('task_preset_key'))).toBe(true)
    expect(errs.some((e) => e.includes('occurrence_key'))).toBe(true)
  })

  it('refuses a task key on a regular event', () => {
    expect(errorsOf(payload([observation({ task_preset_key: 'endstate' })])).some((e) => e.includes('only for endgame'))).toBe(true)
  })

  it('refuses an offset that contradicts the time basis', () => {
    expect(errorsOf(payload([observation({ utc_offset_minutes: 480 })])).length).toBe(1)
    expect(errorsOf(payload([observation({ time_basis: 'fixed_offset' })])).length).toBe(1)
    expect(errorsOf(payload([observation({ time_basis: 'fixed_offset', utc_offset_minutes: 900 })])).length).toBe(1)
  })

  it('refuses times that are not real or carry an offset', () => {
    expect(errorsOf(payload([observation({ ends_local: '2026-02-30T03:59' })])).length).toBe(1)
    expect(errorsOf(payload([observation({ ends_local: '2026-12-03T03:59+08:00' })])).length).toBe(1)
    expect(errorsOf(payload([observation({ ends_local: '2026-12-03 03:59' })])).length).toBe(1)
  })

  it('refuses an end before the start, and an exact start with no date', () => {
    expect(errorsOf(payload([observation({ ends_local: '2026-11-18T03:59' })])).some((e) => e.includes('after the start'))).toBe(true)
    expect(errorsOf(payload([observation({ starts_local: null })])).some((e) => e.includes("start_rule is 'exact'"))).toBe(true)
  })

  it('refuses the same observed key twice in one article', () => {
    expect(errorsOf(payload([observation(), observation()])).some((e) => e.includes('used twice'))).toBe(true)
  })

  it('refuses the same article twice in one request', () => {
    const body = payload()
    body.articles.push({ ...body.articles[0] })
    expect(errorsOf(body).some((e) => e.includes('listed twice'))).toBe(true)
  })

  it('refuses non-https links and bad slugs', () => {
    expect(errorsOf(payload([observation({ official_url: 'http://example.com' })])).length).toBe(1)
    expect(errorsOf({ ...payload(), source: 'WuWa Site' }).length).toBe(1)
  })

  it('refuses a published time without an offset', () => {
    expect(errorsOf(payload(undefined, { published_at: '2026-11-12 10:00:00' })).length).toBe(1)
  })

  it('refuses empty or oversized requests', () => {
    expect(errorsOf({ source: 'x', game: 'wuwa', articles: [] }).length).toBeGreaterThan(0)
    expect(errorsOf(null)).toEqual(['body: must be a JSON object'])
    const many = Array.from({ length: LIMITS.observationsPerArticle + 1 }, (_, i) => observation({ observed_key: `k${i}` }))
    expect(errorsOf(payload(many)).some((e) => e.includes('at most'))).toBe(true)
  })

  it('collects every problem in one reply', () => {
    expect(errorsOf(payload([observation({ kind: 'party', name: '', ends_local: 'soon' })])).length).toBe(3)
  })

  it('tidies names and trims raw text', () => {
    const r = checkPayload(payload([observation({ name: '  Lahai-Roi   Blocks:\nTurnabout ', raw_text: 'x'.repeat(900) })]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.articles[0].observations[0].name).toBe('Lahai-Roi Blocks: Turnabout')
    expect(r.payload.articles[0].observations[0].raw_text).toHaveLength(500)
  })
})

describe('sameSecret', () => {
  it('matches only the exact secret', () => {
    expect(sameSecret('abc123', 'abc123')).toBe(true)
    expect(sameSecret('abc124', 'abc123')).toBe(false)
    expect(sameSecret('abc1234', 'abc123')).toBe(false)
    expect(sameSecret(null, 'abc123')).toBe(false)
    expect(sameSecret('', '')).toBe(false)
  })
})

// A request whose body arrives in chunks, counting how many chunks were actually read
function streamed(chunks: string[], headers: Record<string, string> = {}) {
  let pulled = 0
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled < chunks.length) controller.enqueue(enc.encode(chunks[pulled++]))
      else controller.close()
    },
  }, { highWaterMark: 0 }) // pull only when the reader asks, so the count shows what was read
  const req = new Request('https://example.com/ingest', { method: 'POST', body, headers, duplex: 'half' } as RequestInit)
  return { req, pulled: () => pulled }
}

describe('readBodyLimited', () => {
  it('reads a body under the limit', async () => {
    const { req } = streamed(['{"a":', '1}'])
    expect(await readBodyLimited(req, 100)).toEqual({ ok: true, text: '{"a":1}' })
  })

  it('refuses a declared Content-Length over the limit without reading', async () => {
    const { req, pulled } = streamed(['x'.repeat(10)], { 'content-length': '5000' })
    expect(await readBodyLimited(req, 100)).toMatchObject({ ok: false, status: 413 })
    expect(pulled()).toBe(0)
  })

  it('stops reading as soon as the limit is passed', async () => {
    const { req, pulled } = streamed(Array.from({ length: 50 }, () => 'x'.repeat(40)))
    expect(await readBodyLimited(req, 100)).toMatchObject({ ok: false, status: 413 })
    expect(pulled()).toBeLessThan(10) // never the whole 2,000 bytes
  })

  it('refuses a body that is not UTF-8', async () => {
    const req = new Request('https://example.com/ingest', { method: 'POST', body: new Uint8Array([0xff, 0xfe, 0xfd]) })
    expect(await readBodyLimited(req, 100)).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses an empty request', async () => {
    const req = new Request('https://example.com/ingest', { method: 'POST' })
    expect(await readBodyLimited(req, 100)).toMatchObject({ ok: false, status: 400 })
  })
})
