// THM-10: one copy of a page's data, shared by every page that shows it. Opening a page shows the copy
// at once and loads a fresh one quietly in the background, so moving between Today, the game pages and
// Events no longer waits on "Loading…". Local changes (a tick, a stamina value) go into the copy straight
// away; a background load that started before such a change is thrown away and made again, so it can
// never undo a tick you just made.
export type Shared<T> = {
  get: () => T | null
  subscribe: (listener: () => void) => () => void
  /** Change the copy now (ticks feel instant); does nothing before the first load. */
  change: (fn: (value: T) => T) => void
  /** Load a fresh copy; calls made while one is loading share it. */
  refresh: () => Promise<void>
  /** Forget the copy (on sign-out); a load still running is ignored. */
  clear: () => void
}

export function createShared<T>(load: () => Promise<T>): Shared<T> {
  let value: T | null = null
  let version = 0 // bumped by every local change
  let epoch = 0 // bumped by clear()
  let inflight: Promise<void> | null = null
  const listeners = new Set<() => void>()
  const publish = (next: T | null) => {
    value = next
    for (const listener of listeners) listener()
  }

  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    change(fn) {
      if (value === null) return
      version++
      publish(fn(value))
    },
    refresh() {
      if (inflight) return inflight
      const myEpoch = epoch
      inflight = (async () => {
        // At most two tries: if something changed locally while the first was loading, its result may
        // miss that change, so load once more. If it changes again, keep the local copy for now.
        for (let attempt = 0; attempt < 2; attempt++) {
          const started = version
          const fresh = await load()
          if (epoch !== myEpoch) return
          if (version === started) {
            publish(fresh)
            return
          }
        }
      })().finally(() => {
        inflight = null
      })
      return inflight
    },
    clear() {
      epoch++
      version++
      publish(null)
    },
  }
}
