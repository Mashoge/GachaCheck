import { useEffect, useState } from 'react'
import { fetchGameIcons } from './characterImages'

/**
 * Signed links for your game icons, by game id (LTR-8). Refetched only when a game's icon changes;
 * links are reused while they last, so the same icon is not downloaded again. A failure means badges.
 */
export function useGameIcons(games: { id: string; icon_path?: string | null }[]) {
  const [icons, setIcons] = useState<Record<string, string>>({})
  const key = games.map((g) => `${g.id}:${g.icon_path ?? ''}`).join('|')

  useEffect(() => {
    let cancelled = false
    const list = key ? key.split('|').map((part) => {
      const [id, path] = part.split(':')
      return { id, icon_path: path || null }
    }) : []
    fetchGameIcons(list)
      .then((found) => { if (!cancelled) setIcons(found) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [key])

  return icons
}
