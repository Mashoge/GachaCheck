// STA-5: keys for the PC helper that updates Genshin from HoYoLAB (tools/genshin-sync). The database
// makes each key and keeps only its fingerprint (migration 20261120100000_sync_keys.sql); the key itself
// is shown once, when it's made. Cancelling a key deletes it.
import { supabase } from './supabase'
import { formatDuration } from './time'

export const MAX_SYNC_KEYS = 3
// The helper runs every 15 minutes; after an hour without word, something has stopped it
const QUIET_MS = 60 * 60_000

export type SyncKey = {
  id: string
  label: string
  key_hint: string
  created_at: string
  last_used_at: string | null
  last_result: { resin?: number; commissions?: string; skipped?: string } | null
}

export async function listSyncKeys(): Promise<SyncKey[]> {
  const { data, error } = await supabase
    .from('sync_keys')
    .select('id, label, key_hint, created_at, last_used_at, last_result')
    .order('created_at')
  if (error) throw error
  return (data ?? []) as SyncKey[]
}

/** Makes a key and returns it: the only time it can be seen. */
export async function createSyncKey(label: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_sync_key', { p_label: label })
  if (error) throw error
  if (typeof data !== 'string' || !data.startsWith('gcs_')) throw new Error('No key came back. Try again in a moment.')
  return data
}

export async function cancelSyncKey(id: string): Promise<void> {
  const { error } = await supabase.from('sync_keys').delete().eq('id', id)
  if (error) throw error
}

const COMMISSIONS: Record<string, string> = {
  ticked: 'commissions ticked',
  already: 'commissions already done',
  not_done: 'commissions not finished yet',
  no_task: 'no commissions task to tick',
}

/** What a key last did, in a line: "Last update 12m ago: Resin 120, commissions ticked". */
export function lastSyncText(key: Pick<SyncKey, 'last_used_at' | 'last_result'>, now: Date): { text: string; quiet: boolean } {
  if (!key.last_used_at) return { text: 'Not used yet. Run the helper’s setup on your PC with this key.', quiet: false }
  const ago = now.getTime() - new Date(key.last_used_at).getTime()
  const when = ago < 60_000 ? 'just now' : `${formatDuration(ago)} ago`
  const r = key.last_result ?? {}
  const what = [r.resin !== undefined ? `Resin ${r.resin}` : null, r.commissions ? COMMISSIONS[r.commissions] ?? null : null].filter(Boolean).join(', ')
  return {
    text: `Last update ${when}${what ? `: ${what}` : ''}`,
    quiet: ago > QUIET_MS,
  }
}
