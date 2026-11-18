import { describe, expect, it } from 'vitest'
import { readLookChoice, resolveGameMode } from './gameMode'

// Local-time dates, so the test means the same in every time zone
const at = (h: number, m = 0) => new Date(2026, 10, 19, h, m)

describe('resolveGameMode', () => {
  it('keeps a fixed pick whatever the time', () => {
    expect(resolveGameMode('day', at(23))).toBe('day')
    expect(resolveGameMode('night', at(12))).toBe('night')
  })

  it('follows local time on Auto: Day from 6 AM, Night from 6 PM', () => {
    expect(resolveGameMode('auto', at(5, 59))).toBe('night')
    expect(resolveGameMode('auto', at(6))).toBe('day')
    expect(resolveGameMode('auto', at(12))).toBe('day')
    expect(resolveGameMode('auto', at(17, 59))).toBe('day')
    expect(resolveGameMode('auto', at(18))).toBe('night')
    expect(resolveGameMode('auto', at(0))).toBe('night')
  })
})

describe('readLookChoice', () => {
  it('reads a saved pick and falls back to Auto', () => {
    expect(readLookChoice({ getItem: () => 'day' })).toBe('day')
    expect(readLookChoice({ getItem: () => 'night' })).toBe('night')
    expect(readLookChoice({ getItem: () => null })).toBe('auto')
    expect(readLookChoice({ getItem: () => 'purple' })).toBe('auto')
    expect(readLookChoice(null)).toBe('auto')
  })

  it('follows the clock when storage cannot be read', () => {
    expect(readLookChoice({ getItem: () => { throw new Error('blocked') } })).toBe('auto')
  })
})
