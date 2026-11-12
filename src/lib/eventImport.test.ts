import { describe, expect, it } from 'vitest'
import { parseImport, type ImportGame } from './eventImport'

const games: ImportGame[] = [
  { id: 'g-gi', name: 'Genshin Impact', preset_id: 'genshin', timezone: 'Etc/GMT-8', daily_reset_time: '04:00:00' },
  { id: 'g-ww', name: 'Wuthering Waves', preset_id: 'wuwa', timezone: 'Etc/GMT-8', daily_reset_time: '04:00:00' },
  { id: 'g-nte', name: 'Neverness to Everness', preset_id: 'nte', timezone: 'Etc/GMT-8', daily_reset_time: '05:00:00' },
]
const NOW = new Date('2026-11-13T01:00:00+08:00')
const at = (s: string) => new Date(s).toISOString()

describe('pasted event list', () => {
  const pasted = `WuWa
Ascendant Aces | ends 2026-12-21
Lahai-Roi Blocks | ends 2026-12-03 | starts 2026-11-19

NTE
Pixel Surge | ends 2026-11-23 | starts 2026-11-16
Circle Gift | ends 2026-12-23 04:30`

  const lines = parseImport(pasted, games, 'g-gi', [], NOW)

  it('reads every event and uses the game header above it', () => {
    expect(lines.map((l) => [l.gameName, l.name, l.status])).toEqual([
      ['Wuthering Waves', 'Ascendant Aces', 'ready'],
      ['Wuthering Waves', 'Lahai-Roi Blocks', 'ready'],
      ['Neverness to Everness', 'Pixel Surge', 'ready'],
      ['Neverness to Everness', 'Circle Gift', 'ready'],
    ])
  })

  it('without a time, ends one minute before that game\'s reset and starts at the reset', () => {
    expect(lines[0].endsAt).toBe(at('2026-12-21T03:59:00+08:00')) // WuWa resets at 4:00
    expect(lines[1].startsAt).toBe(at('2026-11-19T04:00:00+08:00'))
    expect(lines[2].endsAt).toBe(at('2026-11-23T04:59:00+08:00')) // NTE resets at 5:00
    expect(lines[2].startsAt).toBe(at('2026-11-16T05:00:00+08:00'))
  })

  it('uses a time when one is given', () => {
    expect(lines[3].endsAt).toBe(at('2026-12-23T04:30:00+08:00'))
  })

  it('an event that has already started has no start date', () => {
    const [l] = parseImport('WuWa\nOld one | ends 2026-12-21 | starts 2026-11-12', games, 'g-gi', [], NOW)
    expect(l.status).toBe('ready')
    expect(l.startsAt).toBeNull()
  })

  it('without a header, uses the game picked in the form', () => {
    const [l] = parseImport('Something | ends 2026-12-01', games, 'g-nte', [], NOW)
    expect(l.gameName).toBe('Neverness to Everness')
  })

  it('accepts full game names, a trailing colon, and a plain date as the end', () => {
    const r = parseImport('Wuthering Waves:\nA | 2026-12-01\nGenshin\nB | 2026-12-02 | 2026-11-20', games, 'g-nte', [], NOW)
    expect(r.map((l) => [l.gameName, l.status])).toEqual([['Wuthering Waves', 'ready'], ['Genshin Impact', 'ready']])
    expect(r[1].startsAt).toBe(at('2026-11-20T04:00:00+08:00'))
  })

  it('marks events already in the list, and repeats within the paste', () => {
    const existing = [{ game_id: 'g-ww', name: 'ascendant aces', ends_at: at('2026-12-21T03:59:00+08:00') }]
    const r = parseImport('WuWa\nAscendant Aces | ends 2026-12-21\nNew | ends 2026-12-01\nNew | ends 2026-12-01', games, 'g-gi', existing, NOW)
    expect(r.map((l) => l.status)).toEqual(['duplicate', 'ready', 'duplicate'])
  })

  it('explains lines it cannot use', () => {
    const r = parseImport('Hello there\nWuWa\nNo date |\nBad | ends Dec 21\nGone | ends 2026-11-01\nBackwards | ends 2026-12-01 | starts 2026-12-05', games, 'g-gi', [], NOW)
    expect(r.map((l) => l.status)).toEqual(['problem', 'problem', 'problem', 'problem', 'problem'])
    expect(r[0].problem).toMatch(/Not a game name/)
    expect(r[2].problem).toMatch(/Can't read the date/)
    expect(r[3].problem).toBe('Already ended')
    expect(r[4].problem).toBe('Starts after it ends')
  })

  it('skips blank lines and # comments', () => {
    expect(parseImport('\n# copied from the announcement\n\n', games, 'g-gi', [], NOW)).toEqual([])
  })
})
