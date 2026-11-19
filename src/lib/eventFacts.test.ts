import { describe, expect, it } from 'vitest'
import { eventFacts } from './eventFacts'
import type { GameEvent } from './events'

const at = (d: number, h = 12) => new Date(2026, 10, d, h)
const now = at(19, 18)
const event = (over: Partial<GameEvent> = {}): GameEvent => ({
  id: 'e', game_id: 'g', name: 'Night Rush', starts_at: at(12, 5).toISOString(), ends_at: at(20, 5).toISOString(), note: null, remind: true,
  completed_at: null, source: 'catalog', origin: 'catalog', kind: 'event', official_url: null, catalog_event_id: 'c', picture_path: null, ...over,
})
const asMap = (e: GameEvent) => Object.fromEntries(eventFacts(e, now).map((f) => [f.label, f.value]))

describe('eventFacts', () => {
  it('gives the dates, the length, where it came from and the reminder', () => {
    const facts = asMap(event())
    expect(Object.keys(facts)).toEqual(['Starts', 'Ends', 'Length', 'From', 'Reminder'])
    expect(facts.Length).toBe('8 days')
    expect(facts.From).toBe('Official list')
    expect(facts.Reminder).toBe('On')
    expect(facts.Ends).toContain('20')
  })

  it('says when there is no start date, and leaves out the length', () => {
    const facts = asMap(event({ starts_at: null }))
    expect(facts.Starts).toMatch(/no start date/i)
    expect(facts.Length).toBeUndefined()
  })

  it("names your own and auto-added events, web events, a reminder that's off and a done mark", () => {
    expect(asMap(event({ origin: 'own', source: 'manual' })).From).toBe('Added by you')
    expect(asMap(event({ origin: 'own', source: 'genshin_feed' })).From).toBe('Auto-added')
    const facts = asMap(event({ kind: 'web_event', remind: false, completed_at: at(19, 9).toISOString() }))
    expect(facts.Played).toMatch(/browser/)
    expect(facts.Reminder).toBe('Off')
    expect(facts.Done).toBeDefined()
  })

  it('says when an event has not started yet', () => {
    expect(asMap(event({ starts_at: at(24).toISOString(), ends_at: at(28).toISOString() })).Length).toBe('4 days (not started yet)')
  })
})
