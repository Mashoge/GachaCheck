// LTR-8: your own character pictures for the Today roster cards (THM-6).
//
// Files go to the private Storage bucket "character-art" under <your user id>/<game id>/, and a row in
// character_images remembers the game, order and focus point. Pictures are shrunk in the browser first
// (longest side 1280 px, WebP, or JPEG where the browser cannot write WebP), so each is roughly
// 100-200 KB and Supabase's free storage lasts. The app shows them through signed links that expire,
// reused while they last (THM-7) so the same picture is not downloaded again.
import { supabase } from './supabase'

export const BUCKET = 'character-art'
export const MAX_PER_GAME = 12 // also enforced by the database
export const MAX_INPUT_BYTES = 15 * 1024 * 1024 // a big PC screenshot is 2-8 MB
export const LONG_SIDE = 1280
export const ACCEPT = 'image/png,image/jpeg,image/webp'
// Signed links last 6 hours and are reused until 30 minutes before they expire. The same link means the
// same address, so the browser shows its saved copy instead of downloading the picture again.
const LINK_SECONDS = 6 * 60 * 60
const LINK_MARGIN_MS = 30 * 60_000
const LINKS_KEY = 'gachacheck.pictureLinks'

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

/** The largest square in the middle of a picture (for game icons). */
export function centerSquare(width: number, height: number) {
  const side = Math.min(width, height)
  return { sx: Math.round((width - side) / 2), sy: Math.round((height - side) / 2), side }
}

export const ICON_SIZE = 256

export function iconPath(userId: string, gameId: string, id: string, type: string) {
  return `${userId}/${gameId}/icon-${id}.${type === 'image/jpeg' ? 'jpg' : 'webp'}`
}

/** EVT-11: an event picture lives in the game's folder, named event-<id> (the database checks both). */
export function eventPicturePath(userId: string, gameId: string, id: string, type: string) {
  return `${userId}/${gameId}/event-${id}.${type === 'image/jpeg' ? 'jpg' : 'webp'}`
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

/**
 * Shrink a picture so its longest side is at most LONG_SIDE, as WebP (JPEG if WebP is not possible).
 * With `square`, the middle square is cut out first and made that many pixels wide (game icons).
 */
export async function shrinkImage(file: Blob, square?: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const crop = square ? centerSquare(bitmap.width, bitmap.height) : { sx: 0, sy: 0, side: 0 }
  const size = square
    ? { width: Math.min(square, crop.side), height: Math.min(square, crop.side) }
    : fitWithin(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot resize pictures.')
  if (square) ctx.drawImage(bitmap, crop.sx, crop.sy, crop.side, crop.side, 0, 0, size.width, size.height)
  else ctx.drawImage(bitmap, 0, 0, size.width, size.height)
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

type SavedLink = { url: string; expires: number }

/** A saved link can be reused while it has more than 30 minutes left. */
export function linkStillGood(link: SavedLink | undefined, now: number) {
  return !!link && link.expires - now > LINK_MARGIN_MS
}

// Links are kept on this device so a reload or reopening the app reuses them too
function loadLinks(): Record<string, SavedLink> {
  try {
    const parsed = JSON.parse(localStorage.getItem(LINKS_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
/** Forget saved links (on sign-out), so nothing that opens your pictures stays on the device. */
export function forgetPictureLinks() {
  try {
    localStorage.removeItem(LINKS_KEY)
  } catch {
    // nothing saved
  }
}
function storeLinks(links: Record<string, SavedLink>) {
  try {
    localStorage.setItem(LINKS_KEY, JSON.stringify(links))
  } catch {
    // Not kept: links are simply made again next time
  }
}

/**
 * Signed links for files in the bucket, reusing saved ones while they last (THM-7). Expired links are
 * dropped from the saved list, so it stays small. Pictures and game icons share it.
 */
async function signPaths(paths: string[]): Promise<Map<string, string>> {
  const now = Date.now()
  const saved: Record<string, SavedLink> = {}
  for (const [path, link] of Object.entries(loadLinks())) if (linkStillGood(link, now)) saved[path] = link
  const missing = [...new Set(paths)].filter((path) => !saved[path])
  if (missing.length > 0) {
    const { data: links, error } = await supabase.storage.from(BUCKET).createSignedUrls(missing, LINK_SECONDS)
    if (error) throw error
    for (const l of links) {
      if (l.path && l.signedUrl) saved[l.path] = { url: l.signedUrl, expires: now + LINK_SECONDS * 1000 }
    }
  }
  storeLinks(saved)
  return new Map(paths.filter((path) => saved[path]).map((path) => [path, saved[path].url]))
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

  const urlFor = await signPaths(data.map((r) => r.path))

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

// ---------- event pictures (EVT-11) ----------

/** Signed links for event pictures, by path. A failure means the cards simply show no picture. */
export async function fetchPictureLinks(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  return Object.fromEntries(await signPaths(paths))
}

/** Shrink and upload a picture for an event of this game; returns its path (not yet saved on the event). */
export async function uploadEventPicture(gameId: string, file: File): Promise<string> {
  const problem = fileProblem(file)
  if (problem) throw new Error(problem)
  const blob = await shrinkImage(file)
  const path = eventPicturePath(await userId(), gameId, crypto.randomUUID(), blob.type)
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000' })
  if (error) throw error
  return path
}

/** Remove a picture file (after the event no longer points at it). A leftover file is only wasted space. */
export async function removePictureFile(path: string | null | undefined) {
  if (path) await supabase.storage.from(BUCKET).remove([path])
}

// ---------- game icons (LTR-8, second half) ----------

/** Signed links for the games that have an icon, by game id. */
export async function fetchGameIcons(games: { id: string; icon_path?: string | null }[]): Promise<Record<string, string>> {
  const withIcon = games.filter((g): g is { id: string; icon_path: string } => !!g.icon_path)
  if (withIcon.length === 0) return {}
  const urlFor = await signPaths(withIcon.map((g) => g.icon_path))
  const out: Record<string, string> = {}
  for (const g of withIcon) {
    const url = urlFor.get(g.icon_path)
    if (url) out[g.id] = url
  }
  return out
}

/**
 * Upload a new icon (cut to the middle square, 256 px) and point the game at it, then remove the old
 * file. A new file name each time, so no device keeps showing a cached old icon.
 */
export async function setGameIcon(game: { id: string; icon_path?: string | null }, file: File) {
  const problem = fileProblem(file)
  if (problem) throw new Error(problem)
  const blob = await shrinkImage(file, ICON_SIZE)
  const path = iconPath(await userId(), game.id, crypto.randomUUID(), blob.type)
  const bucket = supabase.storage.from(BUCKET)
  const { error: uploadError } = await bucket.upload(path, blob, { contentType: blob.type, cacheControl: '31536000' })
  if (uploadError) throw uploadError
  const { error } = await supabase.from('games').update({ icon_path: path }).eq('id', game.id)
  if (error) {
    await bucket.remove([path])
    throw error
  }
  if (game.icon_path) await bucket.remove([game.icon_path]) // a leftover file is only wasted space
}

export async function removeGameIcon(game: { id: string; icon_path?: string | null }) {
  const { error } = await supabase.from('games').update({ icon_path: null }).eq('id', game.id)
  if (error) throw error
  if (game.icon_path) await supabase.storage.from(BUCKET).remove([game.icon_path])
}
