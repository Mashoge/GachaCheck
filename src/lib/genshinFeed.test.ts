import { describe, expect, it } from 'vitest'
import { cleanName, laterEndDate, parseFeedTime, pickFeedEvents, serverMinute } from '../../supabase/functions/_shared/genshinFeed.ts'

const ASIA = 'Etc/GMT-8'
const NOW = new Date('2026-11-13T00:30:00+08:00')

// The Asia feed as it was on Nov 13, 2026 (trimmed to the fields the import reads)
const n = (ann_id: number, type_label: string, tag_label: number | string, subtitle: string, start_time: string, end_time: string, title = subtitle) =>
  ({ ann_id, type_label, tag_label, subtitle, title, start_time, end_time })

const FEED = {
  retcode: 0,
  message: 'OK',
  data: {
    timezone: 8,
    list: [
      { type_label: 'Game', list: [n(22011, 'Game', 1, 'New Content Overview', '2026-11-02 12:00:00', '2026-12-15 14:59:59')] },
      {
        type_label: 'Event',
        list: [
          n(21168, 'Event', 3, 'Stygian Onslaught', '2026-11-09 12:00:00', '2026-12-15 03:59:59', 'Stygian Onslaught Event: Disturbance-affected Ley Line challenges'),
          n(21997, 'Event', 2, 'Event Wish "Myriad Patterns Unfold"', '2026-11-02 12:00:00', '2026-11-24 17:59:00'),
          n(21969, 'Event', 3, 'The Grand Defense: Defy the Unjust Judgment', '2026-11-02 12:00:00', '2026-12-16 07:00:00'),
          n(21970, 'Event', 3, 'Hour of Ruin', '2026-11-02 12:00:00', '2026-12-15 14:59:59'),
          n(21971, 'Event', 3, 'Where Kristall Roots Run Deep', '2026-11-02 12:00:00', '2027-01-26 14:59:59'),
          n(21973, 'Event', 3, "Adventurer's Booster Bundles", '2026-11-02 12:00:00', '2026-11-18 23:59:59'),
          n(21972, 'Event', 3, 'Encounter: Interlude of the Long Journey', '2026-11-02 12:00:00', '2026-12-15 14:59:59'),
          n(21974, 'Event', 3, 'Sacred Spirit Chronicle', '2026-11-02 12:00:00', '2026-12-14 03:59:59'),
          n(20834, 'Event', 3, "Genius Invokation TCG - The Forge Realm's Temper", '2026-11-02 12:00:00', '2026-12-16 07:00:00'),
          n(21968, 'Event', 3, "Across the Frozen Wilds, Honing One's Edge", '2026-11-02 12:00:00', '2027-07-14 07:00:00'),
          n(21892, 'Event', 3, 'To Temper Thyself and Journey Far', '2026-10-31 12:00:00', '2027-01-25 03:59:00'),
          n(21812, 'Event', 3, '"The Hunt Begins!"', '2026-08-10 12:00:00', '2027-07-14 07:00:00'),
        ],
      },
      { type_label: 'Miliastra Wonderland', list: [n(21993, 'Miliastra Wonderland', 3, '"Polyphonic Season" Season Opening Announcement', '2026-11-02 12:00:00', '2026-12-15 14:59:59')] },
    ],
  },
}

describe('Genshin feed import', () => {
  const result = pickFeedEvents(FEED, NOW, ASIA)

  it('picks the five real events from the Nov 13 feed, soonest end first', () => {
    expect(result.events.map((e) => e.name)).toEqual([
      'Sacred Spirit Chronicle',
      'Hour of Ruin',
      'Encounter: Interlude of the Long Journey',
      'The Grand Defense: Defy the Unjust Judgment',
      'Where Kristall Roots Run Deep',
    ])
  })

  it('reads end times as server time and keeps the feed id', () => {
    const sacred = result.events[0]
    expect(sacred.endsAt).toBe(new Date('2026-12-14T03:59:59+08:00').toISOString())
    expect(sacred.externalId).toBe('genshin:21974')
  })

  it('skips wishes, bundles, the card game, existing tasks and long-running offers', () => {
    const skipped = result.skipped.map((s) => s.name)
    expect(skipped).toEqual(expect.arrayContaining([
      'Event Wish "Myriad Patterns Unfold"',
      "Adventurer's Booster Bundles",
      "Genius Invokation TCG - The Forge Realm's Temper",
      'To Temper Thyself and Journey Far',
      "Across the Frozen Wilds, Honing One's Edge",
      'The Hunt Begins!',
    ]))
  })

  it('ignores notices outside the Event tab', () => {
    const all = [...result.events.map((e) => e.name), ...result.skipped.map((s) => s.name)]
    expect(all).not.toContain('New Content Overview')
    expect(all.some((x) => x.includes('Polyphonic'))).toBe(false)
  })

  it('turns Stygian Onslaught into the endgame date instead of an event, rounded to 04:00', () => {
    expect(result.events.some((e) => /stygian/i.test(e.name))).toBe(false)
    expect(result.stygian).toEqual({ endsAt: '2026-12-15T04:00', startDay: '2026-11-09' })
  })

  it('leaves out events that have already ended', () => {
    const later = pickFeedEvents(FEED, new Date('2026-12-14T12:00:00+08:00'), ASIA)
    expect(later.events.map((e) => e.name)).not.toContain('Sacred Spirit Chronicle')
  })

  it('refuses a feed that reports an error', () => {
    expect(() => pickFeedEvents({ retcode: -1, message: 'bad request' }, NOW, ASIA)).toThrow('bad request')
    expect(() => pickFeedEvents(null, NOW, ASIA)).toThrow()
  })

  it('survives missing or odd fields', () => {
    const odd = { retcode: 0, data: { list: [{ list: [{ ann_id: 1, type_label: 'Event', tag_label: '3', subtitle: 'X', end_time: 'soon' }, null, {}] }, {}] } }
    const r = pickFeedEvents(odd, NOW, ASIA)
    expect(r.events).toEqual([])
    expect(r.skipped).toEqual([{ name: 'X', reason: 'no end time' }])
  })
})

describe('feed helpers', () => {
  it('cleans names', () => {
    expect(cleanName('"The Hunt Begins!"')).toBe('The Hunt Begins!')
    expect(cleanName('<b>Bold</b> &amp; more')).toBe('Bold & more')
  })

  it('parses server times with or without seconds', () => {
    expect(parseFeedTime('2026-12-14 03:59:59', ASIA)?.toISOString()).toBe('2026-12-13T19:59:59.000Z')
    expect(parseFeedTime('2026-12-14 03:59', ASIA)?.toISOString()).toBe('2026-12-13T19:59:00.000Z')
    expect(parseFeedTime('', ASIA)).toBeNull()
  })

  it('rounds up to the minute in server time', () => {
    expect(serverMinute(new Date('2026-12-14T03:59:59+08:00'), ASIA)).toBe('2026-12-14T04:00')
    expect(serverMinute(new Date('2026-12-14T03:59:00+08:00'), ASIA)).toBe('2026-12-14T03:59')
  })

  it('keeps the later end date', () => {
    expect(laterEndDate(null, '2026-12-15T04:00')).toBe('2026-12-15T04:00')
    expect(laterEndDate('2026-12-15T04:00:00', '2026-11-12T04:00')).toBe('2026-12-15T04:00:00')
    expect(laterEndDate('2026-11-12T04:00:00', '2026-12-15T04:00')).toBe('2026-12-15T04:00')
  })
})
