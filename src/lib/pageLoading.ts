import { useEffect, useSyncExternalStore } from 'react'

// THM-10: whether the page on screen is still loading. Every page shows the shared <Loading> message
// while it waits (and so does the code-loading fallback), and that message reports here, so AppShell can
// cover the wait with a loading screen in the page's own style: the transition is the loading.
let loading = 0
const listeners = new Set<() => void>()
const emit = () => {
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Marks the page as loading while `active` is true (and the calling component is on screen). */
export function useReportLoading(active = true) {
  useEffect(() => {
    if (!active) return
    loading++
    emit()
    return () => {
      loading--
      emit()
    }
  }, [active])
}

export function usePageLoading() {
  return useSyncExternalStore(subscribe, () => loading > 0)
}
