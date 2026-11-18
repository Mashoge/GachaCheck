import { describe, expect, it } from 'vitest'
import { readChoice, resolveDataSaver } from './dataSaver'

describe('Data saver (THM-7)', () => {
  it('follows the browser until you choose', () => {
    expect(resolveDataSaver(null, true)).toBe(true)
    expect(resolveDataSaver(null, false)).toBe(false)
  })

  it('your choice wins over the browser', () => {
    expect(resolveDataSaver('off', true)).toBe(false)
    expect(resolveDataSaver('on', false)).toBe(true)
  })

  it('reads only a valid saved choice, and survives storage that throws', () => {
    expect(readChoice({ getItem: () => 'on' })).toBe('on')
    expect(readChoice({ getItem: () => 'off' })).toBe('off')
    expect(readChoice({ getItem: () => 'maybe' })).toBeNull()
    expect(readChoice({ getItem: () => null })).toBeNull()
    expect(readChoice({ getItem: () => { throw new Error('private mode') } })).toBeNull()
  })
})
