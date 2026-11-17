import { describe, expect, it } from 'vitest'
import { initialGameView, pickGameView, saveGameView } from './gameView'

describe('pickGameView (SUP-2)', () => {
  it('opens a phone on "What\'s left" and a PC on "Everything" when nothing is saved', () => {
    expect(pickGameView(null, false)).toBe('left')
    expect(pickGameView(null, true)).toBe('all')
  })

  it('uses the last choice on this device, whatever the screen size', () => {
    expect(pickGameView('all', false)).toBe('all')
    expect(pickGameView('left', true)).toBe('left')
  })

  it('ignores a value it does not know', () => {
    expect(pickGameView('quick', false)).toBe('left')
    expect(pickGameView('', true)).toBe('all')
  })
})

describe('remembering the choice', () => {
  it('saves and reads back through storage', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    saveGameView('all', storage)
    expect(initialGameView(storage)).toBe('all')
    saveGameView('left', storage)
    expect(initialGameView(storage)).toBe('left')
  })

  it('falls back to the default when storage throws (private mode)', () => {
    const broken = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    expect(() => saveGameView('all', broken)).not.toThrow()
    // Tests run without a window, which counts as a narrow screen
    expect(initialGameView(broken)).toBe('left')
  })

  it('works with no storage at all', () => {
    expect(initialGameView(null)).toBe('left')
    expect(() => saveGameView('all', null)).not.toThrow()
  })
})
