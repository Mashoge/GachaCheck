import { useCallback, useEffect, useState } from 'react'
import { fetchCharacterImages, type CharacterImage } from './characterImages'
import { useRefreshOnFocus } from './useRefreshOnFocus'

// Re-read the list now and then and whenever the app comes back into view. Signed links are reused while
// they last (characterImages.ts), so this does not download the pictures again.
const REFETCH_MS = 45 * 60_000
const NONE: Record<string, CharacterImage[]> = {}

/**
 * Your character pictures by game id (LTR-8). Pictures are decoration: a failure just means no pictures.
 * With `enabled` false (Data saver, or a device without a mouse) nothing is fetched or downloaded.
 */
export function useCharacterImages(enabled = true) {
  const [images, setImages] = useState<Record<string, CharacterImage[]>>({})

  const refresh = useCallback(async () => {
    if (!enabled) return
    try {
      setImages(await fetchCharacterImages())
    } catch {
      // Keep whatever was shown before; the cards work without pictures
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetchCharacterImages()
      .then((list) => {
        if (!cancelled) setImages(list)
      })
      .catch(() => {})
    const timer = window.setInterval(() => void refresh(), REFETCH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [enabled, refresh])
  useRefreshOnFocus(refresh)

  return { images: enabled ? images : NONE, refresh }
}
