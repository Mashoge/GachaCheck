// SUP-2: which tasks a game page shows. A phone starts on "What's left", a PC on "Everything";
// after that, the last choice made on this device is used.

export type GameView = 'left' | 'all'

const KEY = 'gachacheck.game.view'
const WIDE = '(min-width: 768px)'

type Reader = { getItem(key: string): string | null }
type Writer = { setItem(key: string, value: string): void }

/** The saved choice if there is a valid one, else the default for the screen size. */
export function pickGameView(saved: string | null, isWide: boolean): GameView {
  if (saved === 'left' || saved === 'all') return saved
  return isWide ? 'all' : 'left'
}

/** The view to open a game page with. Storage can be missing or throw (private mode); then the default applies. */
export function initialGameView(storage: Reader | null = typeof localStorage === 'undefined' ? null : localStorage): GameView {
  const isWide = typeof window !== 'undefined' && window.matchMedia(WIDE).matches
  let saved: string | null = null
  try {
    saved = storage?.getItem(KEY) ?? null
  } catch {
    // Not remembered on this device; fall back to the default
  }
  return pickGameView(saved, isWide)
}

/** Remembers the choice on this device. Failing to save only means it isn't remembered. */
export function saveGameView(view: GameView, storage: Writer | null = typeof localStorage === 'undefined' ? null : localStorage) {
  try {
    storage?.setItem(KEY, view)
  } catch {
    // Not remembered on this device
  }
}
