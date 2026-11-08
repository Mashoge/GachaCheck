import { useCallback, useEffect, useState } from 'react'
import { loadGames, type GameSummary } from './games'
import { messageOf } from './errors'

// Loads your games (and syncs any outdated presets) for a page.
export function useGames() {
  const [games, setGames] = useState<GameSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadGames()
      .then((list) => {
        if (!cancelled) setGames(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageOf(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      setGames(await loadGames())
      setError(null)
    } catch (err) {
      setError(messageOf(err))
    }
  }, [])

  return { games, loading, error, refresh }
}

export const SHORT_NAMES: Record<string, string> = {
  genshin: 'Genshin',
  wuwa: 'WuWa',
  nte: 'NTE',
}