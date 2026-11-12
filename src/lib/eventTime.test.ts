import { describe, expect, it } from 'vitest'
import { minuteBefore, serverParts, toInstant } from './eventTime'

describe('event dates in server time', () => {
  it('turns a server date and time into the real moment', () => {
    expect(toInstant('2026-11-20', '03:59', 'Etc/GMT-8')).toBe('2026-11-19T19:59:00.000Z')
    expect(toInstant('2026-11-20', '03:59', 'Etc/GMT+5')).toBe('2026-11-20T08:59:00.000Z') // America (UTC-5)
  })

  it('rejects a missing date or time', () => {
    expect(toInstant('', '03:59', 'Etc/GMT-8')).toBeNull()
    expect(toInstant('2026-11-20', '', 'Etc/GMT-8')).toBeNull()
  })

  it('turns a stored moment back into what the server clock shows', () => {
    expect(serverParts('2026-11-19T19:59:00.000Z', 'Etc/GMT-8')).toEqual({ date: '2026-11-20', time: '03:59' })
    expect(serverParts('2026-11-19T16:00:00+00:00', 'Etc/GMT-8')).toEqual({ date: '2026-11-20', time: '00:00' })
  })

  it('round-trips through both', () => {
    const iso = toInstant('2026-12-31', '23:30', 'America/New_York')!
    expect(serverParts(iso, 'America/New_York')).toEqual({ date: '2026-12-31', time: '23:30' })
  })

  it('suggests one minute before the daily reset as the end time', () => {
    expect(minuteBefore('04:00:00')).toBe('03:59')
    expect(minuteBefore('05:00')).toBe('04:59')
    expect(minuteBefore('00:00:00')).toBe('23:59')
  })
})
