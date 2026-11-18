import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { messageOf } from './errors'
import { useRefreshOnFocus } from './useRefreshOnFocus'
import type { Shared } from './shared'

/**
 * A page's view of a shared copy (shared.ts): shows what is already loaded at once, loads a fresh copy
 * in the background when the page opens and when the app comes back into view. `data` is null only
 * until the very first load, which is when the page shows its loading screen.
 */
export function useShared<T>(store: Shared<T>) {
  const data = useSyncExternalStore(store.subscribe, store.get)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      await store.refresh()
      setError(null)
    } catch (err) {
      setError(messageOf(err))
      throw err
    }
  }, [store])
  useRefreshOnFocus(refresh)

  useEffect(() => {
    let cancelled = false
    store
      .refresh()
      .then(() => {
        if (!cancelled) setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageOf(err))
      })
    return () => {
      cancelled = true
    }
  }, [store])

  return { data, error, setError, refresh }
}
