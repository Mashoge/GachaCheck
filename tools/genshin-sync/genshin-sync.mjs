#!/usr/bin/env node
// STA-5: the GachaCheck Genshin sync helper. Runs on your PC (Node 18 or newer, nothing to install).
//
//   node tools/genshin-sync/genshin-sync.mjs setup        asks for your keys and saves them on this PC
//   node tools/genshin-sync/genshin-sync.mjs test         reads your HoYoLAB notes and shows them (sends nothing)
//   node tools/genshin-sync/genshin-sync.mjs run          one update: HoYoLAB -> GachaCheck
//   node tools/genshin-sync/genshin-sync.mjs schedule     updates every 15 minutes in the background (Windows)
//   node tools/genshin-sync/genshin-sync.mjs unschedule   stops the background updates
//   node tools/genshin-sync/genshin-sync.mjs status       where things are saved, and the last few updates
//
// What it does: reads your Genshin Real-Time Notes from HoYoLAB (as the HoYoLAB website does), and sends
// GachaCheck only your Resin, when it'll be full, and whether commissions are done. Your HoYoLAB cookies
// are saved in your own user folder (not in the GachaCheck folder, so never in git) and go only to HoYoLAB.
// The helper key goes only to GachaCheck. Nothing here touches the game.
import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import {
  explainRetcode, maskSecret, notesRequest, pickCookies, readEnv, serverFor, summary, syncFromNotes, taskCommand, TASK_NAME,
} from './lib.mjs'

const SCRIPT = fileURLToPath(import.meta.url)
const REPO = resolve(dirname(SCRIPT), '..', '..')
const WINDOWS = platform() === 'win32'
const HOME = WINDOWS && process.env.APPDATA ? join(process.env.APPDATA, 'GachaCheck') : join(homedir(), '.config', 'gachacheck')
const CONFIG = join(HOME, 'genshin-sync.json')
const LOG = join(HOME, 'genshin-sync.log')
const KEEP_LOG_LINES = 300

// ---------- saved settings ----------
function loadConfig() {
  if (!existsSync(CONFIG)) throw new Error('Not set up yet. Run: node tools/genshin-sync/genshin-sync.mjs setup')
  return JSON.parse(readFileSync(CONFIG, 'utf8'))
}

function saveConfig(config) {
  mkdirSync(HOME, { recursive: true })
  writeFileSync(CONFIG, JSON.stringify(config, null, 2), { mode: 0o600 })
  try { chmodSync(CONFIG, 0o600) } catch { /* Windows: your user folder is already private to you */ }
}

function log(line) {
  const stamped = `${new Date().toISOString()}  ${line}`
  try {
    mkdirSync(HOME, { recursive: true })
    appendFileSync(LOG, stamped + '\n')
    const lines = readFileSync(LOG, 'utf8').split('\n').filter(Boolean)
    if (lines.length > KEEP_LOG_LINES) writeFileSync(LOG, lines.slice(-KEEP_LOG_LINES).join('\n') + '\n')
  } catch { /* the log is a convenience; a sync never fails because of it */ }
  return stamped
}

// ---------- asking questions (secrets aren't echoed) ----------
// One reader for the whole setup. Every line is kept until a question takes it, so answers pasted
// quickly (or piped in) are never dropped.
let reader = null
const lines = []
const waiting = []
function getReader() {
  if (reader) return reader
  reader = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY ?? false })
  const write = reader._writeToOutput?.bind(reader)
  if (write) {
    reader._writeToOutput = (text) => {
      if (!reader.muted) write(text)
      else if (text.includes('\n')) write('\n')
    }
  }
  reader.on('line', (line) => (waiting.length ? waiting.shift()(line) : lines.push(line)))
  reader.on('close', () => { while (waiting.length) waiting.shift()(null) })
  return reader
}

async function ask(question, { secret = false, fallback = '' } = {}) {
  const r = getReader()
  r.muted = false
  r.setPrompt(fallback ? `${question} [${secret ? maskSecret(fallback) : fallback}]: ` : `${question}: `)
  r.prompt()
  r.muted = secret // the question is on screen; what you type or paste next isn't
  const answer = lines.length ? lines.shift() : await new Promise((done) => waiting.push(done))
  r.muted = false
  if (answer === null) throw new Error('Setup stopped before it was finished. Nothing was saved.')
  if (!process.stdin.isTTY) process.stdout.write('\n')
  return answer.trim() || fallback
}

// ---------- HoYoLAB and GachaCheck ----------
async function readNotes(config) {
  const { url, headers } = notesRequest(config)
  let res
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
  } catch (e) {
    throw new Error(`Couldn't reach HoYoLAB (${e.message}). Is this PC online?`)
  }
  const body = await res.json().catch(() => null)
  if (!body) throw new Error(`HoYoLAB answered ${res.status} without data.`)
  const problem = explainRetcode(body.retcode, body.message)
  if (problem) throw new Error(problem)
  return syncFromNotes(body.data)
}

async function sendToGachaCheck(config, sync) {
  let res
  try {
    res = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/sync_genshin`, {
      method: 'POST',
      headers: { apikey: config.publishableKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_key: config.helperKey, p_resin: sync.resin, p_full_in: sync.fullIn, p_commissions: sync.commissions }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (e) {
    throw new Error(`Couldn't reach GachaCheck (${e.message}). Is this PC online?`)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`GachaCheck said no: ${body?.message ?? res.status}`)
  return body
}

// ---------- commands ----------
async function setup() {
  console.log('GachaCheck Genshin sync: setup')
  console.log(`Your answers are saved on this PC only, in ${CONFIG}\n`)
  const old = existsSync(CONFIG) ? loadConfig() : {}
  const env = existsSync(join(REPO, '.env.local')) ? readEnv(readFileSync(join(REPO, '.env.local'), 'utf8')) : {}

  const supabaseUrl = await ask('GachaCheck address (your VITE_SUPABASE_URL)', { fallback: old.supabaseUrl ?? env.VITE_SUPABASE_URL ?? '' })
  const publishableKey = await ask('GachaCheck publishable key (your VITE_SUPABASE_PUBLISHABLE_KEY)', { fallback: old.publishableKey ?? env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '' })
  console.log('\nThe helper key: on the GachaCheck Games page, under Automatic updates, click "Make a helper key" and copy it.')
  const helperKey = await ask('Helper key (gcs_…; not shown as you paste)', { secret: true, fallback: old.helperKey ?? '' })
  if (!/^gcs_[0-9a-f]{64}$/.test(helperKey)) throw new Error('That is not a helper key. It starts with gcs_ and is 68 characters long.')

  const uid = await ask('\nYour Genshin UID (in-game, bottom right of the Paimon menu)', { fallback: old.uid ?? '' })
  if (!serverFor(uid)) throw new Error('That UID is not on HoYoLAB\'s servers (America, Europe, Asia or TW/HK/MO).')

  console.log(`
Your HoYoLAB cookies. They stay on this PC and are sent only to HoYoLAB. Never paste them anywhere else.
  1. In your browser, log in on https://www.hoyolab.com
  2. Press F12, open the Application tab (Storage in Firefox), then Cookies > https://www.hoyolab.com
  3. Copy the values of ltuid_v2 and ltoken_v2 (and ltmid_v2 if it's there).`)
  const cookies = { ...(old.cookies ?? {}) }
  const first = await ask('ltuid_v2 (or paste a whole cookie line)', { secret: true, fallback: cookies.ltuid_v2 ?? '' })
  const line = pickCookies(first)
  if (line.ltuid_v2 && line.ltoken_v2) Object.assign(cookies, line)
  else {
    cookies.ltuid_v2 = first
    cookies.ltoken_v2 = await ask('ltoken_v2', { secret: true, fallback: cookies.ltoken_v2 ?? '' })
    const mid = await ask('ltmid_v2 (Enter to skip)', { secret: true, fallback: cookies.ltmid_v2 ?? '' })
    if (mid) cookies.ltmid_v2 = mid
  }
  if (!cookies.ltuid_v2 || !cookies.ltoken_v2) throw new Error('Both ltuid_v2 and ltoken_v2 are needed.')

  reader?.close()
  const config = { supabaseUrl, publishableKey, helperKey, uid, cookies }
  saveConfig(config)
  console.log('\nSaved. Checking HoYoLAB…')
  const sync = await readNotes(config)
  console.log(`HoYoLAB works: ${summary(sync, {}).replace(/ \(unknown\)/, '')}`)
  console.log('\nNext: "node tools/genshin-sync/genshin-sync.mjs run" for one update, or "… schedule" for every 15 minutes.')
}

async function test() {
  const sync = await readNotes(loadConfig())
  console.log(`From HoYoLAB: ${summary(sync, {}).replace(/ \(unknown\)/, '')}`)
  console.log(sync.commissions ? 'GachaCheck would tick Daily commissions.' : 'GachaCheck would not tick commissions yet.')
  console.log('Nothing was sent to GachaCheck.')
}

async function run() {
  const config = loadConfig()
  const sync = await readNotes(config)
  const result = await sendToGachaCheck(config, sync)
  console.log(log(`OK  ${summary(sync, result)}`))
}

function schedule() {
  if (!WINDOWS) {
    console.log('Background updates are set up for Windows. Elsewhere, add this to your crontab (crontab -e):')
    console.log(`*/15 * * * * "${process.execPath}" "${SCRIPT}" run`)
    return
  }
  loadConfig() // set up first
  const command = taskCommand(process.execPath, SCRIPT)
  execFileSync('schtasks', ['/Create', '/F', '/SC', 'MINUTE', '/MO', '15', '/TN', TASK_NAME, '/TR', command], { stdio: 'inherit' })
  console.log(`\nScheduled "${TASK_NAME}": every 15 minutes while you're logged in, with no window.`)
  console.log('Running the first update now…')
  return run()
}

function unschedule() {
  if (!WINDOWS) return console.log('Remove the genshin-sync line from your crontab (crontab -e).')
  execFileSync('schtasks', ['/Delete', '/F', '/TN', TASK_NAME], { stdio: 'inherit' })
  console.log('Background updates stopped. To cancel the helper key too, use the Games page in GachaCheck.')
}

function status() {
  console.log(`Settings: ${CONFIG}${existsSync(CONFIG) ? '' : ' (not set up yet)'}`)
  if (existsSync(CONFIG)) {
    const c = loadConfig()
    console.log(`  GachaCheck: ${c.supabaseUrl}`)
    console.log(`  Helper key: ${maskSecret(c.helperKey)}   UID: ${c.uid} (${serverFor(c.uid)})   HoYoLAB cookies: saved`)
  }
  if (WINDOWS) {
    try {
      execFileSync('schtasks', ['/Query', '/TN', TASK_NAME, '/FO', 'LIST'], { stdio: 'inherit' })
    } catch {
      console.log('Background updates: not scheduled.')
    }
  }
  console.log(`\nLog: ${LOG}`)
  if (existsSync(LOG)) console.log(readFileSync(LOG, 'utf8').trim().split('\n').slice(-8).join('\n'))
}

const commands = { setup, test, run, schedule, unschedule, status }
const name = process.argv[2]
if (!commands[name]) {
  console.log('Usage: node tools/genshin-sync/genshin-sync.mjs <setup | test | run | schedule | unschedule | status>')
  process.exit(name ? 1 : 0)
}
try {
  await commands[name]()
} catch (e) {
  const message = e instanceof Error ? e.message : String(e)
  console.error(name === 'run' ? log(`ERROR  ${message}`) : `Problem: ${message}`)
  process.exit(1)
}
