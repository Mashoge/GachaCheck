import { useMemo, useState } from 'react'
import { parseImport, type ExistingEvent, type ImportGame } from '../lib/eventImport'
import type { EventInput } from '../lib/events'
import { formatWhen } from '../lib/time'
import { Button, Card, Field, Select, Textarea } from '../components/ui'

type Props = {
  games: ImportGame[]
  existing: ExistingEvent[]
  defaultGameId: string
  now: Date
  onCancel: () => void
  onImport: (inputs: EventInput[]) => Promise<boolean>
}

const EXAMPLE = `WuWa
Ascendant Aces | ends 2026-12-21
Lahai-Roi Blocks | ends 2026-12-03 | starts 2026-11-19

NTE
Pixel Surge | ends 2026-11-23 | starts 2026-11-16`

// Paste a version's events at once. Nothing is saved until you press Add.
export default function EventImport({ games, existing, defaultGameId, now, onCancel, onImport }: Props) {
  const [text, setText] = useState('')
  const [gameId, setGameId] = useState(defaultGameId)
  const [saving, setSaving] = useState(false)

  const lines = useMemo(() => parseImport(text, games, gameId, existing, now), [text, games, gameId, existing, now])
  const ready = lines.filter((l) => l.status === 'ready')

  const add = async () => {
    setSaving(true)
    await onImport(
      ready.map((l) => ({ game_id: l.gameId!, name: l.name!, starts_at: l.startsAt ?? null, ends_at: l.endsAt!, note: null, remind: true })),
    )
    setSaving(false)
  }

  return (
    <Card as="section" className="gc-set flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="-mx-5 -mt-5 border-b border-line px-5 py-3.5">
          <h2 className="gc-label flex items-center"><span aria-hidden="true" className="gc-tick" />Import a list</h2>
        </div>
        <p className="text-sm text-muted">
          One event per line: <code className="text-ink">Name | ends 2026-12-21 | starts 2026-11-19</code>. The start is optional; a time is optional
          (2026-12-21 03:59). Without a time, an event ends one minute before the daily reset. A line with just a game's name switches the game.
          Times are server time.
        </p>
      </div>

      <Field id="import-game" label="Game for lines before any game name" labelSize="sm" className="w-fit">
        <Select value={gameId} onChange={(e) => setGameId(e.target.value)}>
          {games.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </Select>
      </Field>

      <Field id="import-text" label="Paste here" labelSize="sm">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={EXAMPLE}
          spellCheck={false}
          className="font-mono text-xs leading-relaxed"
        />
      </Field>

      {lines.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="gc-label">
            Preview: {ready.length} to add
            {lines.length > ready.length && ` · ${lines.length - ready.length} skipped`}
          </h3>
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-raised">
            {lines.map((l) => (
              <li key={l.line} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2 text-sm">
                {l.status === 'problem' ? (
                  <>
                    <span className="min-w-0 truncate text-muted">
                      Line {l.line}: {l.text}
                    </span>
                    <span className="text-xs text-urgent">{l.problem}</span>
                  </>
                ) : (
                  <>
                    <span className={`min-w-0 ${l.status === 'duplicate' ? 'text-muted line-through' : ''}`}>
                      <span className="text-muted">{l.gameName} · </span>
                      {l.name}
                    </span>
                    <span className="whitespace-nowrap text-xs text-muted">
                      {l.status === 'duplicate'
                        ? 'Already in your list'
                        : `${l.startsAt ? `Starts ${formatWhen(new Date(l.startsAt), now)} · ` : ''}Ends ${formatWhen(new Date(l.endsAt!), now)}`}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() => void add()}
          disabled={saving || ready.length === 0}
        >
          {ready.length === 0 ? 'Add events' : `Add ${ready.length} ${ready.length === 1 ? 'event' : 'events'}`}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  )
}
