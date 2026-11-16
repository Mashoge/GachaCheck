import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeToFocusRefresh } from './useRefreshOnFocus'

const REFRESH_COOLDOWN_MS_FOR_TEST = 1_000

class TestWindow extends EventTarget {}

class TestDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible'
}

function sources() {
  return { windowTarget: new TestWindow(), documentTarget: new TestDocument() }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('subscribeToFocusRefresh', () => {
  it('refreshes on focus and coalesces the paired visibility event', async () => {
    vi.useFakeTimers()
    const { windowTarget, documentTarget } = sources()
    const refresh = vi.fn()
    const cleanup = subscribeToFocusRefresh(refresh, windowTarget, documentTarget)

    windowTarget.dispatchEvent(new Event('focus'))
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(REFRESH_COOLDOWN_MS_FOR_TEST)
    windowTarget.dispatchEvent(new Event('focus'))
    // The completed refresh releases its in-flight guard in a Promise.finally microtask.
    await Promise.resolve()
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledTimes(2)
    cleanup()
  })

  it('does not refresh while hidden, then refreshes when visible again', () => {
    const { windowTarget, documentTarget } = sources()
    const refresh = vi.fn()
    const cleanup = subscribeToFocusRefresh(refresh, windowTarget, documentTarget)

    documentTarget.visibilityState = 'hidden'
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    windowTarget.dispatchEvent(new Event('focus'))
    expect(refresh).not.toHaveBeenCalled()

    documentTarget.visibilityState = 'visible'
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('queues one refresh if the app regains focus during a slow refresh', async () => {
    vi.useFakeTimers()
    const { windowTarget, documentTarget } = sources()
    let finishFirst!: () => void
    const refresh = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve }))
      .mockResolvedValue(undefined)
    const cleanup = subscribeToFocusRefresh(refresh, windowTarget, documentTarget)

    windowTarget.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(REFRESH_COOLDOWN_MS_FOR_TEST)
    windowTarget.dispatchEvent(new Event('focus'))
    expect(refresh).toHaveBeenCalledTimes(1)

    finishFirst()
    await Promise.resolve()
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledTimes(2)
    cleanup()
  })

  it('removes listeners on cleanup', () => {
    const { windowTarget, documentTarget } = sources()
    const refresh = vi.fn()
    const cleanup = subscribeToFocusRefresh(refresh, windowTarget, documentTarget)
    cleanup()

    windowTarget.dispatchEvent(new Event('focus'))
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).not.toHaveBeenCalled()
  })
})
