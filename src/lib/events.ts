import { supabase } from './supabase'

export type GameEvent = {
  id: string
  game_id: string
  name: string
  starts_at: string | null // null = already running
  ends_at: string
  note: string | null
  remind: boolean
  completed_at: string | null // set when marked as done
}

export type EventInput = Pick<GameEvent, 'game_id' | 'name' | 'starts_at' | 'ends_at' | 'note' | 'remind'>

const COLUMNS = 'id, game_id, name, starts_at, ends_at, note, remind, completed_at'

/** Events that haven't ended yet, soonest end first. Ended ones simply stop being loaded. */
export async function fetchEvents(): Promise<GameEvent[]> {
  const { data, error } = await supabase.from('events').select(COLUMNS).gte('ends_at', new Date().toISOString()).order('ends_at')
  if (error) throw error
  return data
}

export async function addEvent(input: EventInput) {
  const { data: auth } = await supabase.auth.getSession()
  const userId = auth.session?.user.id
  if (!userId) throw new Error('You are signed out. Sign in and try again.')
  const { error } = await supabase.from('events').insert({ ...input, user_id: userId })
  if (error) throw error
}

export async function updateEvent(id: string, input: EventInput) {
  const { error } = await supabase.from('events').update(input).eq('id', id)
  if (error) throw error
}

export async function deleteEvent(id: string) {
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) throw error
}

/** Done events stop sending reminders and leave Today, but stay listed under Finished until they end. */
export async function setEventDone(id: string, done: boolean) {
  const { error } = await supabase.from('events').update({ completed_at: done ? new Date().toISOString() : null }).eq('id', id)
  if (error) throw error
}
