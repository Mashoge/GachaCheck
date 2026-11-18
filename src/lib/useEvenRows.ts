import { useLayoutEffect, type RefObject } from 'react'

/**
 * Gives the matching part of cards that sit side by side the same height, so the rows under it line up
 * (e.g. a game name that wraps onto two lines on one Today card). Cards in different rows of the grid,
 * or alone in a row (a phone), are left as they are. Re-checked whenever the grid changes size: a
 * resized window, a font arriving, a card growing.
 */
export function useEvenRows(grid: RefObject<HTMLElement | null>, selector: string, cards: number) {
  useLayoutEffect(() => {
    const el = grid.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const even = () => {
      const parts = [...el.querySelectorAll<HTMLElement>(selector)]
      for (const p of parts) p.style.minHeight = ''
      const rows = new Map<number, HTMLElement[]>()
      for (const p of parts) {
        const top = Math.round((p.closest('article') ?? p).getBoundingClientRect().top)
        rows.set(top, [...(rows.get(top) ?? []), p])
      }
      for (const row of rows.values()) {
        if (row.length < 2) continue
        const tallest = Math.max(...row.map((p) => p.getBoundingClientRect().height))
        for (const p of row) p.style.minHeight = `${tallest}px`
      }
    }
    const watch = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(even)
    })
    watch.observe(el)
    even()
    return () => {
      cancelAnimationFrame(frame)
      watch.disconnect()
    }
  }, [grid, selector, cards])
}
