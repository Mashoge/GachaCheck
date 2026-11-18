// THM-8: each game's own numerals for the big number on its Today card, shown when the card wakes up.
// Only the digits 0-9 of three free Google Fonts (a few KB in all, one request), loaded only on devices
// with a mouse and never with Data saver. The swap is switched on (html[data-gamefonts]) only once all
// three are ready, so the number never flashes in a fallback font; if they fail, it simply stays as is.
import { useEffect } from 'react'

export const GAME_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@1,900&family=Bodoni+Moda:wght@400&family=Nunito:wght@900&text=0123456789&display=swap'

const FACES = ['900 64px "Nunito"', '400 64px "Bodoni Moda"', 'italic 900 64px "Barlow Condensed"']

export function useGameFonts(enabled: boolean) {
  useEffect(() => {
    const root = document.documentElement
    if (!enabled || root.hasAttribute('data-gamefonts')) return
    let cancelled = false
    let link = document.querySelector<HTMLLinkElement>('link[data-gamefonts]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = GAME_FONTS_HREF
      link.dataset.gamefonts = ''
      document.head.appendChild(link)
    }
    const ready = () => {
      Promise.all(FACES.map((face) => document.fonts.load(face, '0123456789')))
        .then((found) => {
          if (!cancelled && found.every((list) => list.length > 0)) root.setAttribute('data-gamefonts', '')
        })
        .catch(() => {})
    }
    if (link.sheet) ready()
    else link.addEventListener('load', ready, { once: true })
    return () => {
      cancelled = true
      link?.removeEventListener('load', ready)
    }
  }, [enabled])
}
