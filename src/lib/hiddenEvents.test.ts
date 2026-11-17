import { describe, expect, it } from 'vitest'
import { catalogInstant, duplicateOf, hiddenFromEvent, hiddenMatch, nameKey, toHiddenEvents, type CatalogCandidate, type HiddenCatalogRow, type HiddenEvent, type HiddenGame } from './hiddenEvents'

const UTC8 = 'Etc/GMT-8' // UTC+8, like the Asia servers
const END = '2031-05-14T19:59:00.000Z' // 03:59 on 15 May, server time UTC+8

describe('nameKey (same as public.catalog_name_key)', () => {
  it('lower-cases and turns punctuation into single spaces', () => {
    expect(nameKey('Lahai-Roi Blocks: Turnabout')).toBe('lahai roi blocks turnabout')
    expect(nameKey('  Pixel   Surge!! ')).toBe('pixel surge')
  })

  it('drops apostrophes instead of splitting the word', () => {
    expect(nameKey("Nacupeda's Pool")).toBe('nacupedas pool')
    expect(nameKey('Nacupeda’s Pool')).toBe('nacupedas pool')
  })

  it('folds full-width letters (NFKC)', () => {
    expect(nameKey('Ｐｉｘｅｌ Surge')).toBe('pixel surge')
  })

  it('keeps names with no Latin letters as they are, lower-cased and trimmed', () => {
    expect(nameKey(' 像素狂潮 ')).toBe('像素狂潮')
  })

  it('stops at 120 characters', () => {
    expect(nameKey('a'.repeat(200))).toHaveLength(120)
  })
})

describe('catalogInstant (same conversion as the user_events view)', () => {
  it('reads server_local times on the game server clock', () => {
    expect(catalogInstant('2031-05-15T03:59:00', 'server_local', null, UTC8)).toBe(END)
  })

  it('reads fixed_offset times with the printed offset, whatever the server', () => {
    expect(catalogInstant('2031-05-15T03:59:00', 'fixed_offset', 480, 'America/New_York')).toBe(END)
    expect(catalogInstant('2031-05-15 05:00:00', 'fixed_offset', 60, UTC8)).toBe('2031-05-15T04:00:00.000Z')
  })

  it('gives up on a missing offset or an unreadable time', () => {
    expect(catalogInstant('2031-05-15T03:59:00', 'fixed_offset', null, UTC8)).toBeNull()
    expect(catalogInstant('soon', 'server_local', null, UTC8)).toBeNull()
  })
})

describe('toHiddenEvents', () => {
  const games: HiddenGame[] = [
    { id: 'g-nte', preset_id: 'nte', server: 'asia', timezone: UTC8 },
    { id: 'g-wuwa', preset_id: 'wuwa', server: 'america', timezone: 'America/New_York' },
  ]
  const now = new Date('2031-05-10T00:00:00Z')
  const row = (over: Partial<HiddenCatalogRow>): HiddenCatalogRow => ({
    id: 'c1', game: 'nte', server_scope: 'all', kind: 'event', name: 'Pixel Surge',
    ends_local: '2031-05-15T03:59:00', time_basis: 'server_local', utc_offset_minutes: null, status: 'confirmed', ...over,
  })

  it('lists an official event on the game it belongs to, with its real end time', () => {
    expect(toHiddenEvents({ catalog: [row({})], own: [] }, games, true, now)).toEqual([
      { key: 'cat:c1', origin: 'catalog', id: 'c1', game_id: 'g-nte', name: 'Pixel Surge', ends_at: END, kind: 'event' },
    ])
  })

  it('respects the server an event is limited to', () => {
    const rows = { catalog: [row({ id: 'asia-only', server_scope: 'asia' }), row({ id: 'eu-only', server_scope: 'europe' })], own: [] }
    expect(toHiddenEvents(rows, games, true, now).map((e) => e.id)).toEqual(['asia-only'])
  })

  it('leaves out ended, unconfirmed, non-event and unknown-game rows', () => {
    const rows = {
      catalog: [
        row({ id: 'ended', ends_local: '2031-05-01T03:59:00' }),
        row({ id: 'review', status: 'needs_review' }),
        row({ id: 'banner', kind: 'banner' }),
        row({ id: 'no-end', ends_local: null }),
        row({ id: 'genshin', game: 'genshin' }),
      ],
      own: [{ id: 'o-gone', game_id: 'g-deleted', name: 'Old', ends_at: END }],
    }
    expect(toHiddenEvents(rows, games, true, now)).toEqual([])
  })

  it('leaves out web events while they are switched off', () => {
    const rows = { catalog: [row({ id: 'web', kind: 'web_event' })], own: [] }
    expect(toHiddenEvents(rows, games, true, now)).toHaveLength(1)
    expect(toHiddenEvents(rows, games, false, now)).toHaveLength(0)
  })

  it('mixes official and imported events, soonest end first', () => {
    const rows = {
      catalog: [row({ id: 'later', name: 'B later', ends_local: '2031-05-20T03:59:00' })],
      own: [{ id: 'o1', game_id: 'g-wuwa', name: 'A imported', ends_at: '2031-05-12T00:00:00+00:00' }],
    }
    expect(toHiddenEvents(rows, games, true, now).map((e) => `${e.origin}:${e.id}`)).toEqual(['own:o1', 'catalog:later'])
  })
})

describe('hiddenFromEvent', () => {
  const base = { game_id: 'g', name: 'Pixel Surge', ends_at: END, kind: 'event' as const }

  it('points an official event at its catalog row', () => {
    expect(hiddenFromEvent({ ...base, id: 'cat:c1', origin: 'catalog', catalog_event_id: 'c1' })).toMatchObject({ key: 'cat:c1', origin: 'catalog', id: 'c1' })
  })

  it('points an imported event at its own row', () => {
    expect(hiddenFromEvent({ ...base, id: 'e1', origin: 'own', catalog_event_id: null })).toMatchObject({ key: 'e1', origin: 'own', id: 'e1' })
  })

  it('returns null for an official event without its catalog link', () => {
    expect(hiddenFromEvent({ ...base, id: 'cat:?', origin: 'catalog', catalog_event_id: null })).toBeNull()
  })
})

// Same cases as supabase/tests/user_events_view.sql, checks 18 to 25
describe('duplicateOf (same rule as the user_events view)', () => {
  const game = 'g'
  const official = (catalogId: string, name: string, ends_at = END): CatalogCandidate => ({ catalogId, game_id: game, name, ends_at })
  const catalog = [
    official('p_sub', 'ZZ View Pfx Blocks: Turnabout'),
    official('p_short', 'ZZ View Pfx Short'),
    official('p_word', 'ZZ View Pfx Campaigner'),
    official('p_one', 'ZZ View Pfx Twin: One'),
    official('p_two', 'ZZ View Pfx Twin: Two'),
    official('p_far', 'ZZ View Pfx Far: Later'),
    official('p_same', 'ZZ View Pfx Same'),
    official('p_sib', 'ZZ View Pfx Same: Sequel'),
  ]
  const own = (name: string, ends_at = END) => duplicateOf({ game_id: game, name, ends_at }, catalog)

  it('18: own name is the start of the official name', () => {
    expect(own('ZZ View Pfx Blocks')).toEqual(['p_sub'])
  })

  it('20: official name is the start of the own name', () => {
    expect(own('ZZ View Pfx Short - my notes')).toEqual(['p_short'])
  })

  it('21: whole words only', () => {
    expect(own('ZZ View Pfx Campaign')).toEqual([])
  })

  it('22: two possible official events, so neither counts', () => {
    expect(own('ZZ View Pfx Twin')).toEqual([])
  })

  it('23: similar name but ends three days apart', () => {
    expect(own('ZZ View Pfx Far', '2031-05-11T19:59:00.000Z')).toEqual([])
  })

  it('24-25: an exact match wins over a longer-named sibling', () => {
    expect(own('ZZ View Pfx Same')).toEqual(['p_same'])
  })

  it('needs the same game and an end within a day', () => {
    expect(duplicateOf({ game_id: 'other', name: 'ZZ View Pfx Same', ends_at: END }, catalog)).toEqual([])
    expect(own('ZZ View Pfx Same', '2031-05-15T19:59:00.000Z')).toEqual(['p_same']) // exactly one day later
  })

  it('ignores a prefix shorter than 4 characters', () => {
    expect(duplicateOf({ game_id: game, name: 'Zap', ends_at: END }, [official('x', 'Zap Attack')])).toEqual([])
    expect(duplicateOf({ game_id: game, name: 'Zaps', ends_at: END }, [official('x', 'Zaps Attack')])).toEqual(['x'])
  })
})

describe('hiddenMatch', () => {
  const hidden: HiddenEvent = { key: 'cat:h', origin: 'catalog', id: 'h', game_id: 'g', name: 'Pixel Surge', ends_at: END, kind: 'event' }

  it('finds the hidden official event a new own event would be swallowed by', () => {
    expect(hiddenMatch({ game_id: 'g', name: 'pixel surge', ends_at: END }, [], [hidden])).toBe(hidden)
  })

  it('counts visible official events as candidates too, like the view', () => {
    // Two partial candidates (one hidden, one visible): the view keeps the own event, so nothing to warn about
    const partialHidden = { ...hidden, name: 'Pixel Surge: Part One' }
    const visible = [{ catalogId: 'v', game_id: 'g', name: 'Pixel Surge: Part Two', ends_at: END }]
    expect(hiddenMatch({ game_id: 'g', name: 'Pixel Surge', ends_at: END }, visible, [partialHidden])).toBeNull()
  })

  it('ignores hidden imported events: they never swallow an own event', () => {
    expect(hiddenMatch({ game_id: 'g', name: 'Pixel Surge', ends_at: END }, [], [{ ...hidden, origin: 'own', key: 'e1', id: 'e1' }])).toBeNull()
  })
})
