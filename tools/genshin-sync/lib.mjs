// STA-5: the parts of the Genshin sync helper that don't touch the network or your files, so they can be
// tested (lib.test.mjs). The helper itself is genshin-sync.mjs.
import { createHash } from 'node:crypto'

// HoYoLAB's Real-Time Notes for Genshin, on the overseas (HoYoLAB) servers
export const NOTES_URL = 'https://bbs-api-os.hoyolab.com/game_record/genshin/api/dailyNote'
// The request signature the HoYoLAB website uses (overseas), as used by open-source tools such as
// genshin.py. HoYoLAB can change it; if it does, requests are refused and the helper says so.
export const DS_SALT = '6s25p5ox5y14umn1p61aqyyvbvvl3lrt'
export const TASK_NAME = 'GachaCheck Genshin sync'

/** The HoYoLAB server for a Genshin UID: the digits before the last eight say which region it's on. */
export function serverFor(uid) {
  const text = String(uid ?? '').trim()
  if (!/^\d{9,10}$/.test(text)) return null
  return { 6: 'os_usa', 7: 'os_euro', 8: 'os_asia', 18: 'os_asia', 9: 'os_cht' }[text.slice(0, -8)] ?? null
}

/** The DS header: "<seconds>,<6 random letters>,<md5 of salt, time and letters>". */
export function dynamicSecret(seconds = Math.floor(Date.now() / 1000), letters = randomLetters()) {
  const hash = createHash('md5').update(`salt=${DS_SALT}&t=${seconds}&r=${letters}`).digest('hex')
  return `${seconds},${letters},${hash}`
}

function randomLetters(n = 6) {
  const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return Array.from({ length: n }, () => abc[Math.floor(Math.random() * abc.length)]).join('')
}

/**
 * Reads the HoYoLAB cookies you paste in setup: either the three values one by one, or a whole cookie
 * line ("ltuid_v2=…; ltoken_v2=…"). Only these three are kept; anything else in the line is dropped.
 */
export function pickCookies(text) {
  const out = {}
  for (const part of String(text ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const name = part.slice(0, i).trim()
    const value = part.slice(i + 1).trim()
    if (['ltuid_v2', 'ltoken_v2', 'ltmid_v2'].includes(name) && value) out[name] = value
  }
  return out
}

export function cookieHeader({ ltuid_v2, ltoken_v2, ltmid_v2 }) {
  return [`ltuid_v2=${ltuid_v2}`, `ltoken_v2=${ltoken_v2}`, ltmid_v2 ? `ltmid_v2=${ltmid_v2}` : null].filter(Boolean).join('; ')
}

/** The request for your notes: address and headers, signed like the HoYoLAB website. */
export function notesRequest(config, seconds, letters) {
  const url = `${NOTES_URL}?role_id=${encodeURIComponent(config.uid)}&server=${serverFor(config.uid)}`
  return {
    url,
    headers: {
      Cookie: cookieHeader(config.cookies),
      DS: dynamicSecret(seconds, letters),
      'x-rpc-app_version': '1.5.0',
      'x-rpc-client_type': '5',
      'x-rpc-language': 'en-us',
      Origin: 'https://act.hoyolab.com',
      Referer: 'https://act.hoyolab.com/',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    },
  }
}

/**
 * What GachaCheck needs from your notes: Resin, seconds until it's full, and whether commissions are done
 * (all finished and the bonus claimed from Katheryne). Newer notes also carry a daily_task block; it's
 * used when the older fields are missing.
 */
export function syncFromNotes(data) {
  const resin = Number(data?.current_resin)
  if (!Number.isInteger(resin) || resin < 0) throw new Error('HoYoLAB sent notes without a Resin number.')
  const fullIn = Math.max(0, Math.round(Number(data?.resin_recovery_time ?? 0)) || 0)
  const task = data?.daily_task ?? {}
  const finished = Number(data?.finished_task_num ?? task.finished_num ?? 0)
  const total = Number(data?.total_task_num ?? task.total_num ?? 0)
  const claimed = Boolean(data?.is_extra_task_reward_received ?? task.is_extra_task_reward_received)
  return { resin, maxResin: Number(data?.max_resin) || null, fullIn, finished, total, claimed, commissions: total > 0 && finished >= total && claimed }
}

/** HoYoLAB's answer codes, in words, with what to do. */
export function explainRetcode(retcode, message = '') {
  switch (retcode) {
    case 0:
      return null
    case -100:
    case -101:
    case 10001:
      return 'HoYoLAB says you are not logged in: your cookies have expired. Log in on hoyolab.com again, then run setup again with the new cookies.'
    case 10102:
      return 'Real-Time Notes are turned off. On hoyolab.com, open your Battle Chronicle settings and turn on Real-Time Notes for Genshin.'
    case 1034:
    case 5003:
    case 10035:
    case 10041:
      return 'HoYoLAB wants a check that you are human. Open hoyolab.com in your browser and view your Real-Time Notes once; the helper will try again in 15 minutes.'
    case 10101:
    case -110:
      return 'HoYoLAB says too many requests. The helper will try again in 15 minutes.'
    case 1008:
      return 'HoYoLAB could not find that Genshin UID on this account. Run setup again and check the UID.'
    case -10001:
    case -10002:
      return `HoYoLAB refused the request (${message || retcode}). Its request signing may have changed; the helper needs an update.`
    default:
      return `HoYoLAB answered with code ${retcode}${message ? `: ${message}` : ''}.`
  }
}

/** One line for the log and the console, with no secrets in it. */
export function summary(sync, result) {
  const commissions = { ticked: 'ticked', already: 'already ticked', not_done: 'not done yet', no_task: 'no task to tick' }[result?.commissions] ?? 'unknown'
  if (result?.skipped === 'too_soon') return 'Skipped: the last update was less than a minute ago.'
  return `Resin ${sync.resin}${sync.maxResin ? `/${sync.maxResin}` : ''}, full in ${duration(sync.fullIn)}; commissions ${sync.finished}/${sync.total}${sync.claimed ? ', bonus claimed' : ''} (${commissions}).`
}

export function duration(seconds) {
  if (!seconds) return 'now (full)'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

/** VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY from the repo's .env.local, so setup can offer them. */
export function readEnv(text) {
  const out = {}
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*(VITE_SUPABASE_URL|VITE_SUPABASE_PUBLISHABLE_KEY)\s*=\s*"?([^"\s#]+)"?/.exec(line)
    if (m) out[m[1]] = m[2]
  }
  return out
}

/** The Windows scheduled task's command: Node run hidden (conhost --headless), so no window pops up. */
export function taskCommand(nodePath, scriptPath) {
  const command = `conhost.exe --headless "${nodePath}" "${scriptPath}" run`
  if (command.length > 261) throw new Error('The folder paths are too long for a Windows scheduled task (261 characters at most). Move the GachaCheck folder to a shorter path.')
  return command
}

export function maskSecret(value) {
  const text = String(value ?? '')
  return text.length <= 8 ? '****' : `${text.slice(0, 4)}…${text.slice(-4)}`
}
