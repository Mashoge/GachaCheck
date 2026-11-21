import { describe, expect, it } from 'vitest'
import { lastSyncText } from './syncKeys'

const now = new Date('2026-11-20T10:00:00Z')
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()

describe('lastSyncText', () => {
  it('says when a key has never been used', () => {
    expect(lastSyncText({ last_used_at: null, last_result: null }, now)).toEqual({ text: expect.stringMatching(/^Not used yet/), quiet: false })
  })

  it('says when the last update was and what it did', () => {
    const { text, quiet } = lastSyncText({ last_used_at: ago(12), last_result: { resin: 120, commissions: 'ticked' } }, now)
    expect(text).toBe('Last update 12m ago: Resin 120, commissions ticked')
    expect(quiet).toBe(false)
  })

  it('says "just now" within the first minute', () => {
    expect(lastSyncText({ last_used_at: ago(0.5), last_result: { resin: 3, commissions: 'not_done' } }, now).text)
      .toBe('Last update just now: Resin 3, commissions not finished yet')
  })

  it('flags a helper that has gone quiet for over an hour', () => {
    expect(lastSyncText({ last_used_at: ago(61), last_result: { resin: 200 } }, now)).toMatchObject({ quiet: true })
    expect(lastSyncText({ last_used_at: ago(59), last_result: { resin: 200 } }, now)).toMatchObject({ quiet: false })
  })
})
