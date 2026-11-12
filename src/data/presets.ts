// Game presets: the single source of truth for servers, resets, stamina and tasks.
// When a game changes something: edit it here, bump that preset's version, update lastChecked.
// Existing games sync automatically on next load.

export type ResetRule = 'daily' | 'weekly' | 'monthly' | 'interval' | 'dated' | 'none'
export type TaskCategory = 'routine' | 'endgame' | 'goal'

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
  estimated?: boolean      // cap or refill rate not confirmed yet; the app labels it "estimated"
}

export interface PresetTask {
  key: string                 // stable id: never change it once released
  title: string
  rule: ResetRule
  category?: TaskCategory     // default 'routine'
  optional?: boolean          // starts hidden; the player can show it
  note?: string
  weeklyTarget?: number       // e.g. 5 days a week
  targetEditable?: boolean    // player can set their own weekly target (e.g. allowance depends on progress)
  monthlyDay?: number         // for rule 'monthly'
  cycleAnchor?: string        // 'YYYY-MM-DD' server date, for rule 'interval'
  cycleDays?: number          // for rule 'interval'
  cycleEndsAt?: string        // 'YYYY-MM-DDTHH:MM' server time, for rule 'dated' (omit if unknown)
  meter?: string              // key of the stamina meter this task spends; ticking it asks for the new value
}

export interface GamePreset {
  id: string
  version: number
  lastChecked: string         // YYYY-MM-DD
  name: string
  taskExample: string         // placeholder for "Add your own"
  dailyResetTime: string      // 'HH:MM' server time
  weeklyResetDay: number      // 0 = Sunday, 1 = Monday
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

const daily = (key: string, title: string, extra: Partial<PresetTask> = {}): PresetTask => ({
  key, title, rule: 'daily', ...extra,
})
const weekly = (key: string, title: string, extra: Partial<PresetTask> = {}): PresetTask => ({
  key, title, rule: 'weekly', ...extra,
})
const monthly = (key: string, title: string, day: number, extra: Partial<PresetTask> = {}): PresetTask => ({
  key, title, rule: 'monthly', monthlyDay: day, ...extra,
})
const endgame = (key: string, title: string, schedule: Partial<PresetTask>): PresetTask => ({
  key, title, rule: 'dated', category: 'endgame', ...schedule,
})

export const PRESETS: GamePreset[] = [
  {
    id: 'genshin',
    version: 5,
    lastChecked: '2026-11-08',
    name: 'Genshin Impact',
    taskExample: 'e.g. Build Columbina',              // Genshin
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
      daily('commissions', 'Daily commissions', { note: '4 commissions or Encounter Points' }),
      daily('spend-resin', 'Spend Original Resin', { meter: 'resin' }),
      daily('hoyolab', 'HoYoLAB check-in'),
      daily('expeditions', 'Collect and send expeditions'),
      daily('teapot-daily', 'Teapot: Realm Currency + Companionship EXP'),
      daily('bp-daily', 'Battle Pass dailies'),
      daily('welkin', 'Claim Welkin Moon', { optional: true }),
      daily('temper', 'To Temper Thyself: 120 Resin + commissions', {
        optional: true, weeklyTarget: 5, note: '5 days a week for 8 weeks earns a free constellation',
      }),
      daily('mail', 'Check mail', { optional: true }),
      weekly('weekly-bosses', 'Weekly bosses', { note: 'First 3 claims cost less Resin' }),
      weekly('reputation', 'Reputation bounties'),
      weekly('realm-depot', 'Teapot: Realm Depot'),
      weekly('bp-weekly', 'Battle Pass weeklies'),
      monthly('paimons-bargains', "Paimon's Bargains", 1, { note: 'Fates for Stardust' }),
      endgame('spiral-abyss', 'Spiral Abyss', { rule: 'monthly', monthlyDay: 16 }),
      endgame('imaginarium', 'Imaginarium Theater', { rule: 'monthly', monthlyDay: 1 }),
      endgame('stygian', 'Stygian Onslaught', { note: 'Runs per version; dates updated each patch' }),
    ],
  },
  {
    id: 'wuwa',
    version: 6,
    lastChecked: '2026-11-09',
    name: 'Wuthering Waves',
    taskExample: 'e.g. Farm Echoes for my main DPS',  // WuWa
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
      daily('daily-activity', 'Daily activity (100 points)'),
      daily('spend-waveplates', 'Spend Waveplates', { meter: 'waveplates' }),
      daily('podcast-daily', 'Pioneer Podcast dailies'),
      daily('lunite', 'Claim Lunite Subscription', { optional: true }),
      daily('mail', 'Check mail', { optional: true }),
      weekly('weekly-bosses', 'Weekly bosses (3 claims)'),
      weekly('weekly-activity', 'Weekly activity points', { note: 'Full Astrite reward at 5,000 · final tier at 6,000' }),
      weekly('echo-drops', 'Enhanced Echo drops', {
        targetEditable: true,
        note: 'Set your weekly allowance (depends on Data Bank level)',
      }),
      weekly('podcast-weekly', 'Pioneer Podcast weeklies'),
      weekly('shop', 'Weekly shop exchanges'),
      endgame('tower', 'Tower of Adversity', { rule: 'interval', cycleAnchor: '2026-09-14', cycleDays: 28 }),
      endgame('whimpering', 'Whimpering Wastes', { rule: 'interval', cycleAnchor: '2026-09-28', cycleDays: 28 }),
      // Seen in game on Nov 9: current cycle ends Nov 12, 04:00. Next dates once the cycle length is confirmed.
      endgame('endstate', 'Endstate Matrix', { cycleEndsAt: '2026-11-12T04:00', note: 'Cycle length to be confirmed' }),
    ],
  },
  {
    id: 'nte',
    version: 4,
    lastChecked: '2026-11-09',
    name: 'Neverness to Everness',
    taskExample: 'e.g. Upgrade my Arcs',              // NTE
    dailyResetTime: '05:00',
    weeklyResetDay: 1,
    defaultServer: 'asia',
    servers: [
      { id: 'asia', label: 'Asia (UTC+8)', timezone: UTC_PLUS_8 },
      { id: 'sea', label: 'Southeast Asia (UTC+8)', timezone: UTC_PLUS_8 },
      { id: 'america', label: 'America (US Eastern)', timezone: 'America/New_York', note: UNVERIFIED },
      { id: 'europe', label: 'Europe (UTC+1)', timezone: UTC_PLUS_1, note: UNVERIFIED },
    ],
    // Cap seen in game on Nov 9 (360/360). Refill rate still to be confirmed.
    meters: [{ key: 'pixels', name: 'Character Pixels', cap: 360, minutesPerPoint: 6, estimated: true }],
    tasks: [
      daily('commissions', 'Daily commissions (Exploration Guide)'),
      daily('spend-pixels', 'Spend Character Pixels', { meter: 'pixels' }),
      daily('crackdown', 'Illegal Activities Crackdown'),
      daily('witch', "Witch's House fortune"),
      daily('pool', "Nacupeda's Pool rewards"),
      daily('cafe', 'Café Fons'),
      daily('bp-daily', 'Battle Pass dailies'),
      daily('mail', 'Check mail', { optional: true }),
      weekly('anomaly', 'Anomaly Pilgrimage (weekly bosses)'),
      weekly('city-stamina', 'Spend City Stamina'),
      weekly('auction', "Ebisu's Auction House"),
      weekly('realm-greed', 'Realm of Greed'),
      weekly('special-delivery', 'Special Delivery Commissions'),
      weekly('bp-weekly', 'Battle Pass weeklies'),
      monthly('monthly-shop', 'Monthly shop refresh', 1),
      // In game: "Special Routes typically reset every 14 days"; current route ends Nov 19, 05:00.
      endgame('beyond-rails', 'Beyond the Rails', { rule: 'interval', cycleAnchor: '2026-11-05', cycleDays: 14 }),
    ],
  },
]

export function findPreset(id: string | null | undefined) {
  return PRESETS.find((p) => p.id === id)
}

export function findServer(preset: GamePreset | undefined, serverId: string | null | undefined) {
  return preset?.servers.find((s) => s.id === serverId)
}