// THM-3: Day and Night on the game pages. A choice remembered on this device: Day, Night, or Auto, which
// follows the clock (Day from 6 AM to 6 PM local time, like the games' own day and night). Only the game
// pages change; the rest of the app stays dark.
import { useSyncExternalStore } from 'react'

const KEY = 'gachacheck.gamePageLook'
const CHANGED = 'gachacheck:gamepagelook'

export type GameLookChoice = 'auto' | 'day' | 'night'
export type GameMode = 'day' | 'night'

/** Games whose page has a Day look so far; the others keep their one look and show no switch. */
export const GAMES_WITH_DAY = new Set(['genshin'])

export const DAY_STARTS = 6
export const NIGHT_STARTS = 18

/** Day or Night: your pick, or with Auto, the local time (Day from 06:00 until 18:00). */
export function resolveGameMode(choice: GameLookChoice, now: Date): GameMode {
  if (choice !== 'auto') return choice
  const h = now.getHours()
  return h >= DAY_STARTS && h < NIGHT_STARTS ? 'day' : 'night'
}

type Reader = { getItem(key: string): string | null }

export function readLookChoice(storage: Reader | null = typeof localStorage === 'undefined' ? null : localStorage): GameLookChoice {
  try {
    const v = storage?.getItem(KEY) ?? null
    return v === 'day' || v === 'night' ? v : 'auto'
  } catch {
    return 'auto' // storage unavailable (private mode): follow the clock
  }
}

/** Remember a choice on this device (Auto forgets it). Failing to save only means it isn't remembered. */
export function setLookChoice(choice: GameLookChoice) {
  try {
    if (choice === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // Not remembered on this device
  }
  window.dispatchEvent(new Event(CHANGED))
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY || e.key === null) onChange() } // another tab
  window.addEventListener(CHANGED, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGED, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

/** The page-look choice on this device, updated live. */
export function useLookChoice(): GameLookChoice {
  return useSyncExternalStore(subscribe, () => readLookChoice(), () => 'auto')
}
