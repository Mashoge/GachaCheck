import { describe, expect, it } from 'vitest'
import { MAX_PER_GAME, fileProblem, fitWithin, focusFromPoint, imagePath, linkStillGood, nudgeFocus, roomFor } from './characterImages'

describe('character pictures (LTR-8)', () => {
  it('shrinks the longest side to 1280 px, keeping the shape, and never enlarges', () => {
    expect(fitWithin(3840, 2160)).toEqual({ width: 1280, height: 720 })   // 4K PC screenshot
    expect(fitWithin(1170, 2532)).toEqual({ width: 591, height: 1280 })   // phone screenshot
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(5000, 1)).toEqual({ width: 1280, height: 1 })
  })

  it('stores files in your own folder for the game, named by type', () => {
    expect(imagePath('u1', 'g1', 'abc', 'image/webp')).toBe('u1/g1/abc.webp')
    expect(imagePath('u1', 'g1', 'abc', 'image/jpeg')).toBe('u1/g1/abc.jpg')
  })

  it('turns a click into a focus point inside the picture, clamped to its edges', () => {
    const rect = { left: 100, top: 50, width: 200, height: 100 }
    expect(focusFromPoint(200, 100, rect)).toEqual({ x: 50, y: 50 })
    expect(focusFromPoint(110, 60, rect)).toEqual({ x: 5, y: 10 })
    expect(focusFromPoint(0, 999, rect)).toEqual({ x: 0, y: 100 })
    expect(focusFromPoint(10, 10, { left: 0, top: 0, width: 200, height: 0 })).toBeNull() // picture not loaded yet
  })

  it('moves the focus point with the arrow keys (Shift for bigger steps) and ignores other keys', () => {
    expect(nudgeFocus({ x: 50, y: 35 }, 'ArrowLeft')).toEqual({ x: 45, y: 35 })
    expect(nudgeFocus({ x: 50, y: 35 }, 'ArrowDown', true)).toEqual({ x: 50, y: 55 })
    expect(nudgeFocus({ x: 98, y: 2 }, 'ArrowRight')).toEqual({ x: 100, y: 2 })
    expect(nudgeFocus({ x: 50, y: 2 }, 'ArrowUp')).toEqual({ x: 50, y: 0 })
    expect(nudgeFocus({ x: 50, y: 35 }, 'Enter')).toBeNull()
  })

  it('accepts PNG, JPEG and WebP up to 15 MB', () => {
    expect(fileProblem({ name: 'a.png', type: 'image/png', size: 5_000_000 })).toBeNull()
    expect(fileProblem({ name: 'a.webp', type: 'image/webp', size: 100 })).toBeNull()
    expect(fileProblem({ name: 'a.gif', type: 'image/gif', size: 100 })).toMatch(/not a PNG, JPEG or WebP/)
    expect(fileProblem({ name: 'a.heic', type: '', size: 100 })).toMatch(/not a PNG/)
    expect(fileProblem({ name: 'big.png', type: 'image/png', size: 16 * 1024 * 1024 })).toMatch(/larger than 15 MB/)
  })

  it(`keeps a game at ${MAX_PER_GAME} pictures at most`, () => {
    expect(roomFor(0, 3)).toBe(3)
    expect(roomFor(10, 5)).toBe(2)
    expect(roomFor(12, 1)).toBe(0)
    expect(roomFor(13, 1)).toBe(0)
  })

  it('reuses a signed link until 30 minutes before it expires (THM-7: no repeat downloads)', () => {
    const now = Date.UTC(2026, 10, 18, 12)
    expect(linkStillGood({ url: 'u', expires: now + 6 * 3600_000 }, now)).toBe(true)
    expect(linkStillGood({ url: 'u', expires: now + 31 * 60_000 }, now)).toBe(true)
    expect(linkStillGood({ url: 'u', expires: now + 30 * 60_000 }, now)).toBe(false)
    expect(linkStillGood({ url: 'u', expires: now - 1 }, now)).toBe(false)
    expect(linkStillGood(undefined, now)).toBe(false)
  })
})
