// Reads a pasted list of events, one per line:
//
//   WuWa
//   Lahai-Roi Blocks | ends 2026-12-03 | starts 2026-11-19
//   Ascendant Aces | ends 2026-12-21 03:59
//
// A line that is just a game's name ("WuWa", "NTE", "Wuthering Waves") switches the game for the lines below it.
// Dates and times are the game's server time. Without a time, an event ends one minute before the daily
// reset and starts at the reset, which is when most events change over.

import { minuteBefore, toInstant } from './eventTime'

export type ImportGame = { id: string; name: string; preset_id: string | null; timezone: string; daily_reset_time: string }
export type ExistingEvent = { game_id: string; name: string; ends_at: string }

export type ImportLine = {
  line: number // 1-based, as pasted
  text: string
  status: 'ready' | 'duplicate' | 'problem'
  problem?: string
  gameId?: string
  gameName?: string
  name?: string
  startsAt?: string | null
  endsAt?: string
}

const SHORT: Record<string, string> = { genshin: 'Genshin', wuwa: 'WuWa', nte: 'NTE' }
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function gameNamed(text: string, games: ImportGame[]) {
  const key = norm(text.replace(/:$/, ''))
  if (!key) return undefined
  return games.find((g) => norm(g.name) === key || norm(SHORT[g.preset_id ?? ''] ?? '') === key || norm(g.preset_id ?? '') === key)
}

// "2026-12-03" or "2026-12-03 03:59" (also "2026-12-03T03:59")
function readDate(value: string): { date: string; time: string | null } | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  return { date: m[1], time: m[2] ? `${m[2].padStart(2, '0')}:${m[3]}` : null }
}

const resetTime = (g: ImportGame) => g.daily_reset_time.slice(0, 5)

export function parseImport(text: string, games: ImportGame[], defaultGameId: string, existing: ExistingEvent[], now: Date): ImportLine[] {
  let game = games.find((g) => g.id === defaultGameId) ?? games[0]
  const seen = new Set(existing.map((e) => `${e.game_id}|${norm(e.name)}|${new Date(e.ends_at).toISOString()}`))
  const out: ImportLine[] = []

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return

    if (!line.includes('|')) {
      const named = gameNamed(line, games)
      if (named) {
        game = named
        return
      }
      out.push({ line: i + 1, text: line, status: 'problem', problem: 'Not a game name, and no "| ends …" part' })
      return
    }
    if (!game) {
      out.push({ line: i + 1, text: line, status: 'problem', problem: 'No game to add it to' })
      return
    }

    const [namePart, ...rest] = line.split('|').map((p) => p.trim())
    const base = { line: i + 1, text: line, gameId: game.id, gameName: game.name, name: namePart.slice(0, 80) }
    const problem = (why: string) => out.push({ ...base, status: 'problem', problem: why })

    if (!namePart) return problem('Missing the event name')

    let end: ReturnType<typeof readDate> = null
    let start: ReturnType<typeof readDate> = null
    for (const part of rest) {
      const m = /^(ends?|until|starts?|from)?\s*:?\s*(.*)$/i.exec(part)!
      const word = (m[1] ?? '').toLowerCase()
      const date = readDate(m[2])
      if (!date) return problem(`Can't read the date in "${part}" (use 2026-12-21 or 2026-12-21 03:59)`)
      if (word.startsWith('start') || word === 'from') start = date
      else if (word || !end) end = date
      else start = date // a second plain date is the start
    }
    if (!end) return problem('Missing the end date')

    const endsAt = toInstant(end.date, end.time ?? minuteBefore(game.daily_reset_time), game.timezone)
    const startsAt = start ? toInstant(start.date, start.time ?? resetTime(game), game.timezone) : null
    if (!endsAt || (start && !startsAt)) return problem("Can't read the date")
    if (new Date(endsAt) <= now) return problem('Already ended')
    if (startsAt && startsAt >= endsAt) return problem('Starts after it ends')
    // An event that has already started is simply running; its start doesn't matter any more
    const start2 = startsAt && new Date(startsAt) > now ? startsAt : null

    const key = `${game.id}|${norm(namePart)}|${new Date(endsAt).toISOString()}`
    if (seen.has(key)) {
      out.push({ ...base, status: 'duplicate', startsAt: start2, endsAt })
      return
    }
    seen.add(key)
    out.push({ ...base, status: 'ready', startsAt: start2, endsAt })
  })

  return out
}
