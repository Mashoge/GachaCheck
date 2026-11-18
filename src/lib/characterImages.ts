// LTR-8: your own character pictures for the Today roster cards (THM-6).
//
// Files go to the private Storage bucket "character-art" under <your user id>/<game id>/, and a row in
// character_images remembers the game, order and focus point. Pictures are shrunk in the browser first
// (longest side 1280 px, WebP, or JPEG where the browser cannot write WebP), so each is roughly
// 100-200 KB and Supabase's free storage lasts. The app shows them through signed links that expire.
import { supabase } from './supabase'

export const BUCKET = 'character-art'
export const MAX_PER_GAME = 12 // also enforced by the database
export const MAX_INPUT_BYTES = 15 * 1024 * 1024 // a big PC screenshot is 2-8 MB
export const LONG_SIDE = 1280
export const ACCEPT = 'image/png,image/jpeg,image/webp'
const LINK_SECONDS = 60 * 60

export type CharacterImage = {
  id: string
  gameId: string
  path: string
  url: string | null // signed link; null if it could not be made
  focusX: number
  focusY: number
  sortOrder: number
}

// ---------- pure helpers (tested) ----------

/** Size that fits inside a square of `max` px, keeping the shape. Never enlarges. */
export function fitWithin(width: number, height: number, max = LONG_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function imagePath(userId: string, gameId: string, id: string, type: string) {
  return `${userId}/${gameId}/${id}.${type === 'image/jpeg' ? 'jpg' : 'webp'}`
}

const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)))

/** Focus point from a click inside a picture (percent from left and top); null if the picture has no size yet. */
export function focusFromPoint(x: number, y: number, rect: { left: number; top: number; width: number; height: number }) {
  if (!(rect.width > 0 && rect.height > 0)) return null
  return { x: clamp(((x - rect.left) / rect.width) * 100), y: clamp(((y - rect.top) / rect.height) * 100) }
}

/** Arrow keys move the focus point 5% (Shift: 20%). Returns null for other keys. */
export function nudgeFocus(focus: { x: number; y: number }, key: string, big = false) {
  const step = big ? 20 : 5
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
  }
  const move = moves[key]
  return move ? { x: clamp(focus.x + move[0]), y: clamp(focus.y + move[1]) } : null
}

/** Why a chosen file cannot be used, or null if it can. */
export function fileProblem(file: { type: string; size: number; name: string }) {
  if (!ACCEPT.split(',').includes(file.type)) return `${file.name} is not a PNG, JPEG or WebP picture.`
  if (file.size > MAX_INPUT_BYTES) return `${file.name} is larger than 15 MB.`
  return null
}

/** How many of the chosen files still fit, given the pictures a game already has. */
export function roomFor(existing: number, chosen: number) {
  return Math.max(0, Math.min(chosen, MAX_PER_GAME - existing))
}

// ---------- browser work ----------

/** Shrink a picture so its longest side is at most LONG_SIDE, as WebP (JPEG if WebP is not possible). */
export async function shrinkImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const size = fitWithin(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot resize pictures.')
  ctx.drawImage(bitmap, 0, 0, size.width, size.height)
  bitmap.close()
  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
  const webp = await encode('image/webp', 0.8)
  if (webp && webp.type === 'image/webp') return webp
  // Older Safari writes PNG when asked for WebP; JPEG keeps the file small instead
  const jpeg = await encode('image/jpeg', 0.85)
  if (!jpeg) throw new Error('This browser cannot resize pictures.')
  return jpeg
}

// ---------- database and storage ----------

async function userId() {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('Sign in again to change pictures.')
  return id
}

/** All your pictures, grouped by game, with signed links. */
export async function fetchCharacterImages(): Promise<Record<string, CharacterImage[]>> {
  const { data, error } = await supabase
    .from('character_images')
    .select('id, game_id, path, focus_x, focus_y, sort_order')
    .order('sort_order')
    .order('created_at')
  if (error) throw error
  if (data.length === 0) return {}

  const { data: links, error: linkError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(data.map((r) => r.path), LINK_SECONDS)
  if (linkError) throw linkError
  const urlFor = new Map(links.map((l) => [l.path, l.signedUrl ?? null]))

  const byGame: Record<string, CharacterImage[]> = {}
  for (const r of data) {
    ;(byGame[r.game_id] ??= []).push({
      id: r.id, gameId: r.game_id, path: r.path, url: urlFor.get(r.path) ?? null,
      focusX: r.focus_x, focusY: r.focus_y, sortOrder: r.sort_order,
    })
  }
  return byGame
}

/** Shrink and upload one picture, then record it. A failed record removes the file again. */
export async function addCharacterImage(gameId: string, file: File, sortOrder: number) {
  const problem = fileProblem(file)
  if (problem) throw new Error(problem)
  const blob = await shrinkImage(file)
  const path = imagePath(await userId(), gameId, crypto.randomUUID(), blob.type)
  const bucket = supabase.storage.from(BUCKET)
  const { error: uploadError } = await bucket.upload(path, blob, { contentType: blob.type, cacheControl: '31536000' })
  if (uploadError) throw uploadError
  const { error } = await supabase.from('character_images').insert({ game_id: gameId, path, sort_order: sortOrder })
  if (error) {
    await bucket.remove([path])
    throw error
  }
}

export async function setImageFocus(id: string, focus: { x: number; y: number }) {
  const { error } = await supabase.from('character_images').update({ focus_x: focus.x, focus_y: focus.y }).eq('id', id)
  if (error) throw error
}

/** Remove a picture: the record first (so it disappears at once), then the file. */
export async function removeCharacterImage(image: Pick<CharacterImage, 'id' | 'path'>) {
  const { error } = await supabase.from('character_images').delete().eq('id', image.id)
  if (error) throw error
  await supabase.storage.from(BUCKET).remove([image.path]) // a leftover file is only wasted space
}

/** Before a game is deleted: remove every file in its folder (the records go with the game). */
export async function removeGameImages(gameId: string) {
  const folder = `${await userId()}/${gameId}`
  const bucket = supabase.storage.from(BUCKET)
  const { data, error } = await bucket.list(folder, { limit: 100 })
  if (error || !data?.length) return
  await bucket.remove(data.map((f) => `${folder}/${f.name}`))
}
