import { useEffect, useId, useState } from 'react'
import { cancelSyncKey, createSyncKey, lastSyncText, listSyncKeys, MAX_SYNC_KEYS, type SyncKey } from '../lib/syncKeys'
import { messageOf } from '../lib/errors'
import { useNow } from '../lib/useNow'
import { Button, Input, Notice, useConfirm } from './ui'

// STA-5: Genshin updates itself. A small helper on your PC (tools/genshin-sync in the repo) reads your
// HoYoLAB Real-Time Notes every 15 minutes and sends your Resin and whether commissions are done, using a
// helper key made here. The key is shown once; cancelling it stops the helper at once.
export function SyncHelper() {
  const [keys, setKeys] = useState<SyncKey[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('My PC')
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<string | null>(null) // a key just made, until you close it
  const [copied, setCopied] = useState(false)
  const now = useNow()
  const confirm = useConfirm()
  const nameId = useId()
  const keyId = useId()

  const load = () =>
    listSyncKeys()
      .then((list) => setKeys(list))
      .catch((e) => setError(messageOf(e)))

  useEffect(() => {
    let cancelled = false
    listSyncKeys()
      .then((list) => { if (!cancelled) setKeys(list) })
      .catch((e) => { if (!cancelled) setError(messageOf(e)) })
    return () => { cancelled = true }
  }, [])

  const make = async () => {
    setBusy(true)
    setError(null)
    try {
      setMade(await createSyncKey(label.trim()))
      setCopied(false)
      await load()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (key: SyncKey) => {
    const ok = await confirm({
      title: `Cancel the key "${key.label}"?`,
      message: 'The helper using it stops updating GachaCheck at once. You can make a new key any time.',
      confirmLabel: 'Cancel key',
      cancelLabel: 'Keep it',
      danger: true,
    })
    if (!ok) return
    try {
      await cancelSyncKey(key.id)
      await load()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  const copy = async () => {
    if (!made) return
    try {
      await navigator.clipboard.writeText(made)
      setCopied(true)
    } catch {
      // No clipboard access: the key is selected in its field, ready for Ctrl+C
      ;(document.getElementById(keyId) as HTMLInputElement | null)?.select()
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="sync-h">
      <h2 id="sync-h" className="text-base font-semibold">Automatic updates</h2>
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <h3 className="gc-label">Genshin from HoYoLAB</h3>
        <p className="text-sm text-muted">
          A small helper on your PC reads your Genshin Real-Time Notes on HoYoLAB every 15 minutes. It updates your
          Original Resin, and ticks Daily commissions once all four are done and the bonus is claimed. Your HoYoLAB
          login stays on your PC; GachaCheck never sees it.
        </p>
        <p className="text-xs text-muted">
          Opt-in. HoYoverse&apos;s terms don&apos;t allow unofficial automation, so tools like this are used at your own
          risk. The helper only reads what HoYoLAB already shows you, and never touches the game.
        </p>

        {error && <Notice tone="error">{error}</Notice>}

        {made && (
          <div className="flex flex-col gap-2 rounded-xl border border-accent/60 bg-raised p-3" role="status">
            <label htmlFor={keyId} className="text-sm font-semibold">Your new helper key</label>
            <div className="flex items-center gap-2">
              <Input id={keyId} readOnly value={made} onFocus={(e) => e.currentTarget.select()} className="w-0 min-w-0 flex-1 font-mono text-xs" />
              <Button size="sm" variant="primary" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</Button>
            </div>
            <p className="text-xs text-muted">
              Copy it now: it won&apos;t be shown again. Paste it when the helper&apos;s setup asks for it, and nowhere else.
            </p>
            <Button size="sm" variant="quiet" className="self-start" onClick={() => setMade(null)}>Done, hide it</Button>
          </div>
        )}

        {keys && keys.length > 0 && (
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {keys.map((k) => {
              const last = lastSyncText(k, now)
              return (
                <li key={k.id} className="flex items-start gap-3 py-2.5">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-semibold">
                      {k.label} <span className="font-mono text-xs font-normal text-muted">…{k.key_hint}</span>
                    </span>
                    <span className={`text-xs ${last.quiet ? 'text-urgent' : 'text-muted'}`}>
                      {last.text}
                      {last.quiet && '. No word for over an hour: is your PC on, and the helper scheduled?'}
                    </span>
                  </span>
                  <Button size="sm" variant="quiet" onClick={() => void cancel(k)} aria-label={`Cancel the key ${k.label}`}>
                    Cancel
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        {keys && keys.length < MAX_SYNC_KEYS && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (label.trim()) void make()
            }}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor={nameId} className="gc-label">Key name</label>
              <Input id={nameId} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. My PC" />
            </span>
            <Button type="submit" disabled={busy || !label.trim()}>{busy ? 'Making…' : 'Make a helper key'}</Button>
          </form>
        )}

        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">How to set up the helper</summary>
          <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-muted">
            <li>On hoyolab.com, open your Battle Chronicle settings and turn on <b className="text-ink">Real-Time Notes</b> for Genshin.</li>
            <li>Make a helper key here and copy it.</li>
            <li>
              In PowerShell, in your GachaCheck folder, run{' '}
              <code className="rounded bg-raised px-1 font-mono text-xs text-ink">node tools/genshin-sync/genshin-sync.mjs setup</code>{' '}
              and answer its questions. It explains where to find your HoYoLAB cookies.
            </li>
            <li>
              Run <code className="rounded bg-raised px-1 font-mono text-xs text-ink">node tools/genshin-sync/genshin-sync.mjs schedule</code>{' '}
              to update every 15 minutes in the background.
            </li>
          </ol>
        </details>
      </div>
    </section>
  )
}
