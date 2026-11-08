// Game presets: the single source of truth for servers, resets and stamina.
// When a game changes a value: edit it here, bump that preset's version, update lastChecked.

export type Frequency = 'daily' | 'weekly'

export interface PresetServer {
  id: string        // saved on the game, e.g. 'asia'
  label: string     // shown in the app
  timezone: string  // IANA zone of the server clock
  note?: string     // shown when a value is unverified
}

export interface PresetMeter {
  key: string
  name: string
  cap: number
  minutesPerPoint: number
  fillsWhenFullOf?: string // key of the meter that must be full first
}

export interface PresetTask {
  title: string
  frequency: Frequency
}

export interface GamePreset {
  id: string
  version: number
  lastChecked: string       // YYYY-MM-DD
  name: string
  dailyResetTime: string    // 'HH:MM' server time
  weeklyResetDay: number    // 0 = Sunday, 1 = Monday
  defaultServer: string
  servers: PresetServer[]
  meters: PresetMeter[]
  tasks: PresetTask[]
}

// Fixed-offset zones. The sign is flipped: 'Etc/GMT-8' means UTC+8.
const UTC_PLUS_8 = 'Etc/GMT-8'
const UTC_PLUS_1 = 'Etc/GMT-1'
const UTC_MINUS_5 = 'Etc/GMT+5'
const UNVERIFIED = 'Unverified: guides disagree on daylight saving for this server.'

export const PRESETS: GamePreset[] = [
  {
    id: 'genshin',
    version: 2,
    lastChecked: '2026-11-08',
    name: 'Genshin Impact',
    dailyResetTime: '04:00',
    weeklyResetDay: 1,
    defaultServer: 'asia',
    servers: [
      { id: 'america', label: 'America (UTC-5)', timezone: UTC_MINUS_5 },
      { id: 'europe', label: 'Europe (UTC+1)', timezone: UTC_PLUS_1 },
      { id: 'asia', label: 'Asia (UTC+8)', timezone: UTC_PLUS_8 },
      { id: 'tw-hk-mo', label: 'TW, HK, MO (UTC+8)', timezone: UTC_PLUS_8 },
    ],
    meters: [{ key: 'resin', name: 'Original Resin', cap: 200, minutesPerPoint: 8 }],
    tasks: [
      { title: 'HoYoLAB check-in', frequency: 'daily' },
      { title: 'Daily commissions', frequency: 'daily' },
      { title: 'Spend Resin', frequency: 'daily' },
      { title: 'Collect expeditions', frequency: 'daily' },
      { title: 'Weekly bosses', frequency: 'weekly' },
    ],
  },
  {
    id: 'wuwa',
    version: 2,
    lastChecked: '2026-11-08',
    name: 'Wuthering Waves',
    dailyResetTime: '04:00',
    weeklyResetDay: 1,
    defaultServer: 'sea',
    servers: [
      { id: 'america', label: 'America (UTC-5)', timezone: UTC_MINUS_5 },
      { id: 'asia', label: 'Asia (UTC+8)', timezone: UTC_PLUS_8 },
      { id: 'europe', label: 'Europe (UTC+1)', timezone: UTC_PLUS_1 },
      { id: 'hmt', label: 'HMT (UTC+8)', timezone: UTC_PLUS_8 },
      { id: 'sea', label: 'SEA (UTC+8)', timezone: UTC_PLUS_8 },
    ],
    meters: [
      { key: 'waveplates', name: 'Waveplates', cap: 240, minutesPerPoint: 6 },
      { key: 'crystals', name: 'Waveplate Crystals', cap: 480, minutesPerPoint: 12, fillsWhenFullOf: 'waveplates' },
    ],
    tasks: [
      { title: 'Daily activity', frequency: 'daily' },
      { title: 'Spend Waveplates', frequency: 'daily' },
      { title: 'Weekly bosses', frequency: 'weekly' },
    ],
  },
  {
    id: 'nte',
    version: 2,
    lastChecked: '2026-11-08',
    name: 'Neverness to Everness',
    dailyResetTime: '05:00',
    weeklyResetDay: 1,
    defaultServer: 'asia',
    servers: [
      { id: 'asia', label: 'Asia (UTC+8)', timezone: UTC_PLUS_8 },
      { id: 'sea', label: 'Southeast Asia (UTC+8)', timezone: UTC_PLUS_8 },
      { id: 'america', label: 'America (US Eastern)', timezone: 'America/New_York', note: UNVERIFIED },
      { id: 'europe', label: 'Europe (UTC+1)', timezone: UTC_PLUS_1, note: UNVERIFIED },
    ],
    meters: [{ key: 'pixels', name: 'Character Pixels', cap: 240, minutesPerPoint: 6 }],
    tasks: [
      { title: 'Exploration Guide dailies', frequency: 'daily' },
      { title: 'Spend Character Pixels', frequency: 'daily' },
      { title: 'Anomaly Pilgrimage (weekly bosses)', frequency: 'weekly' },
      { title: 'Spend City Stamina', frequency: 'weekly' },
    ],
  },
]

export function findPreset(id: string | null | undefined) {
  return PRESETS.find((p) => p.id === id)
}

export function findServer(preset: GamePreset | undefined, serverId: string | null | undefined) {
  return preset?.servers.find((s) => s.id === serverId)
}