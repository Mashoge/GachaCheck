import { useEffect, useState } from 'react'
import { gameOfPath } from '../lib/pageTransition'

// THM-10: the game flourish and the loading screen, as one transition. Opening a game page plays its
// flourish every time: it covers the page in the game's style (Genshin: a gold star with a soft glow on a
// night sky; WuWa: a slate sweep led by a cyan scan; NTE: dark slanted panels slamming in with a moving
// LOADING strip), then reveals it. If the page is still loading, it holds a calm loop until the data
// arrives, so a longer transition always means something is loading. Any other page that is loading
// (pageLoading.ts) gets GachaCheck's version: a slanted slash and three bars. Dark on purpose (never
// much brighter than the page), our own shapes, no official art. Under the header and bottom bar, never
// takes clicks; Data saver, reduced motion and high contrast hide it and the page's "Loading…" shows.
const COVER_MS = 280
const OUT_MS = 340

type Phase = 'off' | 'cover' | 'covered' | 'hold' | 'out'
type Look = 'app' | 'genshin' | 'wuwa' | 'nte'
type State = { phase: Phase; look: Look; n: number }

const lookOf = (pathname: string): Look => (gameOfPath(pathname) as Look | null) ?? 'app'

export function LoadingCurtain({ pathname, loading }: { pathname: string; loading: boolean }) {
  const [state, setState] = useState<State>({ phase: 'off', look: 'app', n: 0 })
  const [lastPath, setLastPath] = useState(pathname)

  // Worked out while rendering, so a game page's flourish starts in the same update as the page itself
  let next = state
  if (pathname !== lastPath) {
    setLastPath(pathname)
    if (gameOfPath(pathname)) next = { phase: 'cover', look: lookOf(pathname), n: state.n + 1 }
  }
  if (next.phase === 'off' && loading) next = { phase: 'cover', look: lookOf(pathname), n: next.n + 1 }
  if (next.phase === 'covered') next = { ...next, phase: loading ? 'hold' : 'out' }
  if (next.phase === 'hold' && !loading) next = { ...next, phase: 'out' }
  if (next.phase === 'out' && loading) next = { ...next, phase: 'hold' }
  if (next !== state) setState(next)

  // The cover and the reveal each take a fixed time
  const { phase, n } = state
  useEffect(() => {
    if (phase !== 'cover' && phase !== 'out') return
    const timer = window.setTimeout(
      () => setState((s) => (s.n === n && s.phase === phase ? { ...s, phase: phase === 'cover' ? 'covered' : 'off' } : s)),
      phase === 'cover' ? COVER_MS : OUT_MS,
    )
    return () => window.clearTimeout(timer)
  }, [phase, n])

  if (state.phase === 'off') return null
  const look = state.look
  return (
    <div key={n} aria-hidden="true" className="gc-curtain" data-look={look} data-phase={state.phase === 'out' ? 'out' : 'in'}>
      <i className="gc-cu-veil" />
      {look === 'app' && (
        <>
          <i className="gc-cu-slash" />
          <i className="gc-cu-bars">
            <b />
            <b />
            <b />
          </i>
        </>
      )}
      {look === 'genshin' && (
        <>
          <i className="gc-cu-rays" />
          <i className="gc-cu-glow" />
          <i className="gc-cu-star" />
        </>
      )}
      {look === 'wuwa' && (
        <>
          <i className="gc-cu-band" />
          <i className="gc-cu-track">
            <b />
          </i>
        </>
      )}
      {look === 'nte' && (
        <>
          <i className="gc-cu-panel gc-cu-p1" />
          <i className="gc-cu-panel gc-cu-p2" />
          <i className="gc-cu-streak" />
          <i className="gc-cu-ticker">
            <b>{'LOADING ▸ '.repeat(24)}</b>
          </i>
        </>
      )}
      {look !== 'nte' && <i className="gc-cu-label">Loading</i>}
    </div>
  )
}
