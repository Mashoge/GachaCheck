// Reads Genshin's in-game announcement feed and picks out the events worth tracking.
// Pure logic: no network here. The "remind" function fetches the feed and saves the result.
//
// The feed is unofficial (it is what the game's own announcement board loads), so every field is
// read defensively and anything unexpected is skipped instead of failing the whole import.

import { zonedTime } from './time.ts'

const DAY_MS = 86_400_000
export const MAX_DAYS_AHEAD = 90 // longer than this is an ongoing offer, not an event

// Only the Asia server has been checked against the real feed (Nov 13, 2026).
export const FEED_REGIONS: Record<string, string> = { asia: 'os_asia' }

export function feedUrl(region: string) {
  const params = new URLSearchParams({
    game: 'hk4e', game_biz: 'hk4e_global', lang: 'en', bundle_id: 'hk4e_global',
    platform: 'pc', region, level: '55', uid: '100000000',
  })
  return `https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/getAnnList?${params}`
}

// Banners, shop offers, the card game, and things the app already tracks as tasks
const SKIP = /\bwish\b|bundle|booster|top-up|genius invokation|\btcg\b|temper thyself/i
const STYGIAN = /stygian onslaught/i

export type FeedEvent = {
  externalId: string // 'genshin:<ann_id>', so the same notice is only added once
  name: string
  endsAt: string // ISO instant
}

export type StygianPeriod = {
  endsAt: string // server time 'YYYY-MM-DDTHH:MM', the format tasks.cycle_ends_at uses
  startDay: string | null // 'YYYY-MM-DD', saved as cycle_anchor so the whole period counts
}

export type FeedResult = {
  events: FeedEvent[]
  stygian: StygianPeriod | null
  skipped: { name: string; reason: string }[] // shown in a dry run, so the rules can be checked
}

type Raw = Record<string, unknown>

const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

// Titles can carry HTML tags and entities
export function cleanName(v: unknown): string {
  return text(v)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .slice(0, 80)
}

// 'YYYY-MM-DD HH:MM:SS' in server time → the real moment
export function parseFeedTime(v: unknown, timezone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text(v).trim())
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0))
  const at = new Date(zonedTime(y, mo, d, h, mi, timezone).getTime() + (s || 0) * 1000)
  return Number.isNaN(at.getTime()) ? null : at
}

// A moment → 'YYYY-MM-DDTHH:MM' on the server clock, rounded up to the minute (03:59:59 → 04:00)
export function serverMinute(at: Date, timezone: string): string {
  const up = new Date(Math.ceil(at.getTime() / 60_000) * 60_000)
  const p: Record<string, string> = {}
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  for (const part of f.formatToParts(up)) p[part.type] = part.value
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

// All notices from the feed's groups ("Game", "Event", "Miliastra Wonderland", ...)
function notices(feed: unknown): Raw[] {
  const data = (feed as Raw | null)?.data as Raw | undefined
  const groups = Array.isArray(data?.list) ? (data!.list as Raw[]) : []
  return groups
    .flatMap((g) => (Array.isArray(g?.list) ? (g.list as unknown[]) : []))
    .filter((x): x is Raw => typeof x === 'object' && x !== null)
}

export function pickFeedEvents(feed: unknown, now: Date, timezone: string): FeedResult {
  const result: FeedResult = { events: [], stygian: null, skipped: [] }
  if ((feed as Raw | null)?.retcode !== 0) throw new Error(`Genshin feed answered: ${text((feed as Raw | null)?.message) || 'no data'}`)

  const seen = new Set<string>()
  for (const n of notices(feed)) {
    const id = text(n.ann_id)
    const name = cleanName(n.subtitle) || cleanName(n.title)
    if (!id || !name || seen.has(id)) continue
    seen.add(id)

    // Only the "Event" tab, and only notices tagged as events (wish banners are tag 2)
    if (text(n.type_label) !== 'Event') continue
    if (text(n.tag_label) !== '3') {
      result.skipped.push({ name, reason: 'not an event notice' })
      continue
    }

    const end = parseFeedTime(n.end_time, timezone)
    if (!end) {
      result.skipped.push({ name, reason: 'no end time' })
      continue
    }

    if (STYGIAN.test(name) || STYGIAN.test(text(n.title))) {
      // An endgame mode, not an event: its dates go on the Stygian Onslaught task instead
      if (end > now && (!result.stygian || serverMinute(end, timezone) > result.stygian.endsAt)) {
        const start = parseFeedTime(n.start_time, timezone)
        result.stygian = { endsAt: serverMinute(end, timezone), startDay: start ? serverMinute(start, timezone).slice(0, 10) : null }
      }
      result.skipped.push({ name, reason: 'endgame mode (sets the Stygian Onslaught date)' })
      continue
    }
    if (SKIP.test(name) || SKIP.test(text(n.title))) {
      result.skipped.push({ name, reason: 'banner, shop offer, card game or already a task' })
      continue
    }
    if (end <= now) {
      result.skipped.push({ name, reason: 'already ended' })
      continue
    }
    if (end.getTime() - now.getTime() > MAX_DAYS_AHEAD * DAY_MS) {
      result.skipped.push({ name, reason: `ends more than ${MAX_DAYS_AHEAD} days away` })
      continue
    }

    // The feed's start_time is when the notice was posted, not when the event opens, so it isn't used.
    result.events.push({ externalId: `genshin:${id}`, name, endsAt: end.toISOString() })
  }

  result.events.sort((a, b) => a.endsAt.localeCompare(b.endsAt))
  return result
}

// Same rule as the app's preset sync: an end date is only ever replaced by a later one.
export function laterEndDate(a: string | null, b: string | null) {
  const minute = (v: string) => v.replace(' ', 'T').slice(0, 16)
  if (!a) return b
  if (!b) return a
  return minute(a) >= minute(b) ? a : b
}
