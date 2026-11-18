import { describe, expect, it, vi } from 'vitest'
import { createShared } from './shared'

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('a shared copy of page data (THM-10)', () => {
  it('is empty until the first load, then every listener sees the same copy', async () => {
    const store = createShared(async () => ({ n: 1 }))
    const listener = vi.fn()
    store.subscribe(listener)
    expect(store.get()).toBeNull()
    await store.refresh()
    expect(store.get()).toEqual({ n: 1 })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('shares one load between callers that ask at the same time', async () => {
    const load = vi.fn(async () => 'fresh')
    const store = createShared(load)
    await Promise.all([store.refresh(), store.refresh(), store.refresh()])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('applies local changes at once, and only after something has loaded', async () => {
    const store = createShared(async () => 1)
    store.change((n) => n + 1)
    expect(store.get()).toBeNull()
    await store.refresh()
    store.change((n) => n + 1)
    expect(store.get()).toBe(2)
  })

  it('never lets a load that started before a tick undo that tick', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const load = vi.fn().mockReturnValueOnce(Promise.resolve('old')).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const store = createShared<string>(load)
    await store.refresh() // 'old'
    const pending = store.refresh() // loading 'before the tick'
    store.change(() => 'ticked') // the tick lands while it loads
    first.resolve('stale, without the tick')
    await Promise.resolve()
    expect(store.get()).toBe('ticked')
    second.resolve('fresh, with the tick')
    await pending
    expect(store.get()).toBe('fresh, with the tick')
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('forgets the copy on sign-out and ignores a load that was still running', async () => {
    const slow = deferred<string>()
    const store = createShared<string>(() => slow.promise)
    const pending = store.refresh()
    store.clear()
    slow.resolve('previous account')
    await pending
    expect(store.get()).toBeNull()
  })
})
