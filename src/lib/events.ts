import { supabase } from './supabase'
import type { HiddenEvent, HiddenRows } from './hiddenEvents'

export type GameEvent = {
  id: string // a catalog event's id starts with 'cat:'
  game_id: string
  name: string
  starts_at: string | null // null = already running
  ends_at: string
  note: string | null
  remind: boolean
  completed_at: string | null // set when marked as done
  source: string // 'manual', 'genshin_feed' or 'catalog'
  origin: 'own' | 'catalog' // own = yours to edit; catalog = shared, from official announcements
  kind: 'event' | 'web_event'
  official_url: string | null
  catalog_event_id: string | null
}

export type EventInput = Pick<GameEvent, 'game_id' | 'name' | 'starts_at' | 'ends_at' | 'note' | 'remind'>

const COLUMNS = 'id, game_id, name, starts_at, ends_at, note, remind, completed_at, source, origin, kind, official_url, catalog_event_id'

/**
 * Events that haven't ended yet, soonest end first. Ended ones simply stop being loaded.
 * Reads the user_events view: your own events plus the shared catalog events for your games.
 */
export async function fetchEvents(): Promise<GameEvent[]> {
  const { data, error } = await supabase
    .from('user_events')
    .select(COLUMNS)
    .gte('ends_at', new Date().toISOString())
    .order('ends_at')
    .order('name')   // events ending at the same minute keep a stable order
  if (error) throw error
  return data as unknown as GameEvent[]
}

async function currentUserId() {
  const { data: auth } = await supabase.auth.getSession()
  const userId = auth.session?.user.id
  if (!userId) throw new Error('You are signed out. Sign in and try again.')
  return userId
}

export async function addEvent(input: EventInput) {
  const userId = await currentUserId()
  const { error } = await supabase.from('events').insert({ ...input, user_id: userId })
  if (error) throw error
}

/** Adds several events at once (from a pasted list). */
export async function addEvents(inputs: EventInput[]) {
  if (inputs.length === 0) return
  const userId = await currentUserId()
  const { error } = await supabase.from('events').insert(inputs.map((input) => ({ ...input, user_id: userId })))
  if (error) throw error
}

// Your own marks on a shared catalog event. Only the fields given are changed.
async function saveCatalogMark(event: GameEvent, marks: { completed_at?: string | null; hidden?: boolean; remind?: boolean; note?: string | null }) {
  if (!event.catalog_event_id) throw new Error('This event is missing its catalog link. Reload and try again.')
  const userId = await currentUserId()
  const { error } = await supabase
    .from('user_event_state')
    .upsert({ user_id: userId, event_id: event.catalog_event_id, ...marks, updated_at: new Date().toISOString() }, { onConflict: 'user_id,event_id' })
  if (error) throw error
}

/** A catalog event's name and dates come from the official source, so only your note and reminder choice are saved. */
export async function updateEvent(event: GameEvent, input: EventInput) {
  if (event.origin === 'catalog') return saveCatalogMark(event, { note: input.note, remind: input.remind })
  const { error } = await supabase.from('events').update(input).eq('id', event.id)
  if (error) throw error
}

/** Imported and catalog events are hidden, not deleted, so they are not added again. */
export async function hideEvent(event: GameEvent) {
  if (event.origin === 'catalog') return saveCatalogMark(event, { hidden: true })
  const { error } = await supabase.from('events').update({ hidden: true }).eq('id', event.id)
  if (error) throw error
}

/**
 * Everything you have hidden, for the Hidden events list. Official events are read from the shared
 * catalog (only your hidden marks are yours); imported events from your own list.
 * Events that already ended are left out, like on the main list.
 */
export async function fetchHiddenEvents(): Promise<HiddenRows> {
  const nowIso = new Date().toISOString()
  const [marks, own] = await Promise.all([
    supabase.from('user_event_state').select('event_id').eq('hidden', true),
    supabase.from('events').select('id, game_id, name, ends_at').eq('hidden', true).gte('ends_at', nowIso),
  ])
  if (marks.error) throw marks.error
  if (own.error) throw own.error

  const ids = marks.data.map((m) => m.event_id)
  if (ids.length === 0) return { catalog: [], own: own.data }

  const { data: catalog, error } = await supabase
    .from('catalog_events')
    .select('id, game, server_scope, kind, name, ends_local, time_basis, utc_offset_minutes, status')
    .in('id', ids)
  if (error) throw error
  return { catalog, own: own.data }
}

/** Puts a hidden event back on your list. A done mark, note and reminder choice you had are kept. */
export async function restoreEvent(event: HiddenEvent) {
  if (event.origin === 'catalog') {
    const userId = await currentUserId()
    const { error } = await supabase
      .from('user_event_state')
      .update({ hidden: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('event_id', event.id)
    if (error) throw error
    return
  }
  const { error } = await supabase.from('events').update({ hidden: false }).eq('id', event.id)
  if (error) throw error
}

export async function deleteEvent(event: GameEvent) {
  const { error } = await supabase.from('events').delete().eq('id', event.id)
  if (error) throw error
}

/** Done events stop sending reminders and leave Today, but stay listed under Finished until they end. */
export async function setEventDone(event: GameEvent, done: boolean) {
  const completed_at = done ? new Date().toISOString() : null
  if (event.origin === 'catalog') return saveCatalogMark(event, { completed_at })
  const { error } = await supabase.from('events').update({ completed_at }).eq('id', event.id)
  if (error) throw error
}

/** Whether web events (played in a browser, outside the game) are listed. On unless you turn it off. */
export async function fetchShowWebEvents(): Promise<boolean> {
  const { data, error } = await supabase.from('user_settings').select('show_web_events').maybeSingle()
  if (error) throw error
  return data?.show_web_events ?? true
}

export async function setShowWebEvents(show: boolean) {
  const userId = await currentUserId()
  const { error } = await supabase.from('user_settings').update({ show_web_events: show }).eq('user_id', userId)
  if (error) throw error
}
