import { useCallback, useEffect, useState } from 'react'
import { fetchCharacterImages, type CharacterImage } from './characterImages'
import { useRefreshOnFocus } from './useRefreshOnFocus'

// Signed links last an hour; fetch fresh ones well before that, and whenever the app comes back into view
const REFETCH_MS = 45 * 60_000

/** Your character pictures by game id (LTR-8). Pictures are decoration: a failure just means no pictures. */
export function useCharacterImages() {
  const [images, setImages] = useState<Record<string, CharacterImage[]>>({})

  const refresh = useCallback(async () => {
    try {
      setImages(await fetchCharacterImages())
    } catch {
      // Keep whatever was shown before; the cards work without pictures
    }
  }, [])

  useEffect(() => {
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
  }, [refresh])
  useRefreshOnFocus(refresh)

  return { images, refresh }
}
