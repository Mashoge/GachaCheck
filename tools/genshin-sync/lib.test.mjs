import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  cookieHeader, duration, dynamicSecret, explainRetcode, maskSecret, notesRequest, pickCookies, readEnv, serverFor, summary,
  syncFromNotes, taskCommand, DS_SALT,
} from './lib.mjs'

describe('serverFor', () => {
  it('finds the HoYoLAB server from the UID', () => {
    expect(serverFor('812345678')).toBe('os_asia')
    expect(serverFor('1812345678')).toBe('os_asia')
    expect(serverFor('612345678')).toBe('os_usa')
    expect(serverFor('712345678')).toBe('os_euro')
    expect(serverFor('912345678')).toBe('os_cht')
  })

  it('refuses mainland China UIDs (not on HoYoLAB) and anything that is not a UID', () => {
    expect(serverFor('112345678')).toBeNull()
    expect(serverFor('8123')).toBeNull()
    expect(serverFor('abc')).toBeNull()
  })
})

describe('the request', () => {
  it('signs it like the HoYoLAB website: time, letters, md5', () => {
    const ds = dynamicSecret(1700000000, 'abcDEF')
    const hash = createHash('md5').update(`salt=${DS_SALT}&t=1700000000&r=abcDEF`).digest('hex')
    expect(ds).toBe(`1700000000,abcDEF,${hash}`)
    expect(dynamicSecret()).toMatch(/^\d{10},[a-zA-Z]{6},[0-9a-f]{32}$/)
  })

  it('asks for your notes on your server, with only the HoYoLAB cookies it needs', () => {
    const req = notesRequest({ uid: '812345678', cookies: { ltuid_v2: '42', ltoken_v2: 'v2_tok' } }, 1700000000, 'abcDEF')
    expect(req.url).toBe('https://bbs-api-os.hoyolab.com/game_record/genshin/api/dailyNote?role_id=812345678&server=os_asia')
    expect(req.headers.Cookie).toBe('ltuid_v2=42; ltoken_v2=v2_tok')
    expect(req.headers['x-rpc-client_type']).toBe('5')
  })
})

describe('cookies', () => {
  it('keeps only the three HoYoLAB login cookies from a pasted line', () => {
    expect(pickCookies('mi18nLang=en-us; ltuid_v2=42; ltoken_v2=v2_a=b; account_id_v2=42; ltmid_v2=mid')).toEqual({ ltuid_v2: '42', ltoken_v2: 'v2_a=b', ltmid_v2: 'mid' })
    expect(cookieHeader({ ltuid_v2: '42', ltoken_v2: 't', ltmid_v2: 'm' })).toBe('ltuid_v2=42; ltoken_v2=t; ltmid_v2=m')
  })

  it('never shows a secret in full', () => {
    expect(maskSecret('gcs_0123456789abcdef')).toBe('gcs_…cdef')
    expect(maskSecret('short')).toBe('****')
  })
})

describe('syncFromNotes', () => {
  const notes = { current_resin: 120, max_resin: 200, resin_recovery_time: '38100', finished_task_num: 4, total_task_num: 4, is_extra_task_reward_received: true }

  it('takes Resin, the time until full, and finished-and-claimed commissions', () => {
    expect(syncFromNotes(notes)).toMatchObject({ resin: 120, fullIn: 38100, commissions: true })
  })

  it('does not tick commissions until the bonus is claimed', () => {
    expect(syncFromNotes({ ...notes, is_extra_task_reward_received: false }).commissions).toBe(false)
    expect(syncFromNotes({ ...notes, finished_task_num: 3 }).commissions).toBe(false)
  })

  it('reads the newer daily_task block when the older fields are missing', () => {
    const newer = { current_resin: 0, resin_recovery_time: '96000', daily_task: { finished_num: 4, total_num: 4, is_extra_task_reward_received: true } }
    expect(syncFromNotes(newer)).toMatchObject({ resin: 0, commissions: true })
  })

  it('refuses notes without a Resin number', () => {
    expect(() => syncFromNotes({})).toThrow(/Resin/)
  })
})

describe('messages', () => {
  it('turns HoYoLAB answer codes into what to do', () => {
    expect(explainRetcode(0)).toBeNull()
    expect(explainRetcode(-100)).toMatch(/cookies have expired/)
    expect(explainRetcode(10102)).toMatch(/turn on Real-Time Notes/)
    expect(explainRetcode(10035)).toMatch(/human/)
    expect(explainRetcode(777, 'odd')).toBe('HoYoLAB answered with code 777: odd.')
  })

  it('sums up a sync in one line, without secrets', () => {
    const line = summary(syncFromNotes({ current_resin: 120, max_resin: 200, resin_recovery_time: '38100', finished_task_num: 4, total_task_num: 4, is_extra_task_reward_received: true }), { commissions: 'ticked' })
    expect(line).toBe('Resin 120/200, full in 10h 35m; commissions 4/4, bonus claimed (ticked).')
    expect(summary({}, { skipped: 'too_soon' })).toMatch(/less than a minute/)
    expect(duration(0)).toBe('now (full)')
  })
})

describe('setup and scheduling', () => {
  it('offers the GachaCheck address and publishable key from .env.local', () => {
    expect(readEnv('VITE_SUPABASE_URL=https://x.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_abc"\nOTHER=1'))
      .toEqual({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })
  })

  it('runs Node hidden from the scheduled task, and refuses paths too long for Windows', () => {
    expect(taskCommand('C:\\Program Files\\nodejs\\node.exe', 'C:\\dev\\gachacheck\\tools\\genshin-sync\\genshin-sync.mjs'))
      .toBe('conhost.exe --headless "C:\\Program Files\\nodejs\\node.exe" "C:\\dev\\gachacheck\\tools\\genshin-sync\\genshin-sync.mjs" run')
    expect(() => taskCommand('C:\\node.exe', 'C:\\' + 'x'.repeat(260))).toThrow(/too long/)
  })
})
