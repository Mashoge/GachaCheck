import { useSyncExternalStore } from 'react'

// True while a CSS media query matches, e.g. useMedia('(max-width: 767px)') for phones
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

// Below Tailwind's md breakpoint, where the bottom bar shows
export const PHONE = '(max-width: 767px)'
