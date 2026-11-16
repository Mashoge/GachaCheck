import { useEffect } from 'react'

const REFRESH_COOLDOWN_MS = 1_000

type BrowserEventTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
type VisibilitySource = BrowserEventTarget & { readonly visibilityState: DocumentVisibilityState }

/**
 * Refreshes data when the app becomes visible or its window regains focus.
 * Browsers fire both events when returning to a tab, so the cooldown coalesces them.
 * If another focus happens during a slow request, one follow-up refresh is queued.
 */
export function subscribeToFocusRefresh(
  refresh: () => void | Promise<void>,
  windowTarget: BrowserEventTarget = window,
  documentTarget: VisibilitySource = document,
): () => void {
  let active = true
  let inFlight = false
  let pending = false
  let lastStartedAt = Number.NEGATIVE_INFINITY

  const execute = () => {
    inFlight = true
    let result: void | Promise<void>
    try {
      result = refresh()
    } catch {
      result = undefined
    }

    void Promise.resolve(result)
      .catch(() => undefined)
      .finally(() => {
        inFlight = false
        if (!active || !pending) return
        if (documentTarget.visibilityState !== 'visible') {
          pending = false
          return
        }
        pending = false
        lastStartedAt = Date.now()
        execute()
      })
  }

  const requestRefresh = () => {
    if (!active || documentTarget.visibilityState !== 'visible') return
    const now = Date.now()
    if (now - lastStartedAt < REFRESH_COOLDOWN_MS) return
    lastStartedAt = now
    if (inFlight) {
      pending = true
      return
    }
    execute()
  }

  const onVisibilityChange: EventListener = () => {
    if (documentTarget.visibilityState === 'visible') requestRefresh()
  }

  windowTarget.addEventListener('focus', requestRefresh)
  documentTarget.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    active = false
    pending = false
    windowTarget.removeEventListener('focus', requestRefresh)
    documentTarget.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

/** Keep server-backed views current when a user returns to an already-open tab/window. */
export function useRefreshOnFocus(refresh: () => void | Promise<void>) {
  useEffect(() => subscribeToFocusRefresh(refresh), [refresh])
}
