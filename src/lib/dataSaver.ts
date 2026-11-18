// THM-7: Data saver. One setting, remembered on this device, that turns off pictures (your character
// pictures, and later official event banners) and decorative animation. Numbers, countdowns and actions
// never change. With no choice made, it follows the browser: on when the browser asks to save data
// (navigator.connection.saveData, e.g. Android's Data Saver or Chrome's Lite mode).
import { useSyncExternalStore } from 'react'

const KEY = 'gachacheck.dataSaver'
const CHANGED = 'gachacheck:datasaver'

export type DataSaverChoice = 'on' | 'off' | null // null = follow the browser

type Reader = { getItem(key: string): string | null }

/** Whether Data saver is on: your choice if you made one, else what the browser asks for. */
export function resolveDataSaver(choice: DataSaverChoice, browserSaveData: boolean) {
  return choice === null ? browserSaveData : choice === 'on'
}

export function readChoice(storage: Reader | null = typeof localStorage === 'undefined' ? null : localStorage): DataSaverChoice {
  try {
    const v = storage?.getItem(KEY) ?? null
    return v === 'on' || v === 'off' ? v : null
  } catch {
    return null // storage unavailable (private mode): follow the browser
  }
}

export function browserSaveData() {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return !!c?.saveData
}

/** Remember a choice on this device (null forgets it). Failing to save only means it isn't remembered. */
export function setDataSaver(choice: DataSaverChoice) {
  try {
    if (choice === null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // Not remembered on this device
  }
  window.dispatchEvent(new Event(CHANGED))
}

function subscribe(onChange: () => void) {
  const conn = (navigator as Navigator & { connection?: EventTarget }).connection
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) onChange() } // another tab changed it
  window.addEventListener(CHANGED, onChange)
  window.addEventListener('storage', onStorage)
  conn?.addEventListener?.('change', onChange)
  return () => {
    window.removeEventListener(CHANGED, onChange)
    window.removeEventListener('storage', onStorage)
    conn?.removeEventListener?.('change', onChange)
  }
}

// One string so React can compare snapshots: "<choice>|<browser asks>"
const snapshot = () => `${readChoice() ?? 'auto'}|${browserSaveData() ? 1 : 0}`

/** { on, choice, browserAsks } for this device, updated live. */
export function useDataSaver() {
  const snap = useSyncExternalStore(subscribe, snapshot, () => 'auto|0')
  const [c, b] = snap.split('|')
  const choice: DataSaverChoice = c === 'on' || c === 'off' ? c : null
  const browserAsks = b === '1'
  return { on: resolveDataSaver(choice, browserAsks), choice, browserAsks }
}
