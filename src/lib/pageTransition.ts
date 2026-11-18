// THM-10: which entrance a page gets when you navigate to it. A game page enters in its game's own way
// (Genshin rises out of a soft blur, WuWa wipes in like a scan, NTE snaps in at a slant); every other page
// fades up. The classes are styled in index.css; the browser's View Transitions run them (React's
// <ViewTransition> in AppShell), and browsers without them simply switch pages.
const GAMES = new Set(['genshin', 'wuwa', 'nte'])

/** The game whose page this is ('genshin', 'wuwa' or 'nte'), or null. */
export function gameOfPath(pathname: string): string | null {
  const game = /^\/game\/([^/]+)/.exec(pathname)?.[1]
  return game && GAMES.has(game) ? game : null
}

export function pageTransitionClass(pathname: string): string {
  const game = gameOfPath(pathname)
  return game ? `gc-page-${game}` : 'gc-page'
}
