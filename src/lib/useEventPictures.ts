import { useEffect, useState } from 'react'
import { fetchPictureLinks } from './characterImages'

/**
 * Signed links for your event pictures, by event id (EVT-11). Refetched only when a picture changes;
 * links are reused while they last, so a picture is not downloaded again. Off (no links, nothing
 * downloaded) when `enabled` is false, as with Data saver. A failure just means no pictures.
 */
export function useEventPictures(events: { id: string; picture_path: string | null }[], enabled: boolean) {
  const [links, setLinks] = useState<Record<string, string>>({})
  const key = enabled ? events.filter((e) => e.picture_path).map((e) => `${e.id}\t${e.picture_path}`).join('\n') : ''

  useEffect(() => {
    let cancelled = false
    const pairs = key ? key.split('\n').map((line) => line.split('\t') as [string, string]) : []
    fetchPictureLinks(pairs.map(([, path]) => path))
      .then((byPath) => {
        if (!cancelled) setLinks(Object.fromEntries(pairs.flatMap(([id, path]) => (byPath[path] ? [[id, byPath[path]]] : []))))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [key])

  return links
}
