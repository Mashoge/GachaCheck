// EVT-14: the facts shown under an event's card in its details (Events page): when it starts and ends,
// how long it runs, where it came from, and whether it reminds you. Pure logic, tested in eventFacts.test.ts.
import type { GameEvent } from './events'

const DAY_MS = 86_400_000

export type Fact = { label: string; value: string }

/** A moment in full, in your local time: "Thu, Dec 3, 3:59 AM". */
export const fullWhen = (at: Date) => at.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function eventFacts(event: GameEvent, now: Date): Fact[] {
  const start = event.starts_at ? new Date(event.starts_at) : null
  const end = new Date(event.ends_at)
  const facts: Fact[] = [
    { label: 'Starts', value: start ? fullWhen(start) : 'No start date given (already running)' },
    { label: 'Ends', value: fullWhen(end) },
  ]
  if (start) {
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS))
    const ago = start <= now ? '' : ' (not started yet)'
    facts.push({ label: 'Length', value: `${days} ${days === 1 ? 'day' : 'days'}${ago}` })
  }
  facts.push({ label: 'From', value: event.origin === 'catalog' ? 'Official list' : event.source === 'manual' ? 'Added by you' : 'Auto-added' })
  if (event.kind === 'web_event') facts.push({ label: 'Played', value: 'In a browser (web event)' })
  facts.push({ label: 'Reminder', value: event.remind ? 'On' : 'Off' })
  if (event.completed_at) facts.push({ label: 'Done', value: fullWhen(new Date(event.completed_at)) })
  return facts
}
