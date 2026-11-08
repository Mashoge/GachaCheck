// Game presets — values checked against public guides on the lastChecked date.
// Changing a preset later: edit it and increase its version (LTR-7).

export type Frequency = 'daily' | 'weekly'

export interface PresetTask {
  title: string
  frequency: Frequency
}

export interface PresetMeter {
  key: string                 // id within this preset
  name: string
  cap: number
  minutesPerPoint: number
  fillsWhenFullOf?: string    // key of the meter that must be full first
}

export interface GamePreset {
  id: string
  version: number
  lastChecked: string       // YYYY-MM-DD
  name: string
  server: string
  timezone: string          // IANA zone of the server clock
  dailyResetTime: string    // 'HH:MM' in server time
  weeklyResetDay: number    // 0 = Sunday, 1 = Monday
  meters: PresetMeter[]
  tasks: PresetTask[]
}

export const PRESETS: GamePreset[] = [
  {
    id: 'genshin',
    version: 1,
    lastChecked: '2026-11-08',
    name: 'Genshin Impact',
    server: 'Asia',
    timezone: 'Asia/Shanghai', // UTC+8
    dailyResetTime: '04:00',
    weeklyResetDay: 1,
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
    version: 1,
    lastChecked: '2026-11-08',
    name: 'Wuthering Waves',
    server: 'SEA',
    timezone: 'Asia/Shanghai', // UTC+8
    dailyResetTime: '04:00',
    weeklyResetDay: 1,
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
    version: 1,
    lastChecked: '2026-11-08',
    name: 'Neverness to Everness',
    server: 'Asia',
    timezone: 'Asia/Shanghai', // UTC+8
    dailyResetTime: '05:00',
    weeklyResetDay: 1,
    meters: [{ key: 'pixels', name: 'Character Pixels', cap: 240, minutesPerPoint: 6 }],
    tasks: [
      { title: 'Exploration Guide dailies', frequency: 'daily' },
      { title: 'Spend Character Pixels', frequency: 'daily' },
      { title: 'Anomaly Pilgrimage (weekly bosses)', frequency: 'weekly' },
      { title: 'Spend City Stamina', frequency: 'weekly' },
    ],
  },
]