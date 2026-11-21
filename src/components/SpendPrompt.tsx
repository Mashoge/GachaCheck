import { useState } from 'react'
import type { MeterState } from '../lib/stamina'
import { Button, Input } from './ui'

// Asks what a stamina meter shows now. Shown under a "Spend …" task right after it is ticked,
// and after "All done" on the game page and on Today. STA-7: also "Set" on a Today card, filled in with
// the current number and with Cancel instead of Skip.
export default function SpendPrompt({ meter, onSave, onSkip, initial, skipLabel = 'Skip' }: {
  meter: MeterState
  onSave: (value: number) => void
  onSkip: () => void
  initial?: number
  skipLabel?: string
}) {
  const [draft, setDraft] = useState(initial === undefined ? '' : String(initial))
  const id = `spent-${meter.id}`
  const value = Number(draft)
  const valid = draft.trim() !== '' && Number.isFinite(value) && value >= 0

  return (
    <form
      className="gc-prompt flex flex-wrap items-center gap-2 border-b border-line bg-raised px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onSave(value)
      }}
    >
      <label htmlFor={id} className="w-full text-xs text-muted">
        How much {meter.name} do you have now? This keeps the countdown and reminders right.
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={`cap ${meter.cap}`}
        className="w-28"
      />
      <Button type="submit" variant="primary" disabled={!valid}>Save</Button>
      <Button onClick={() => onSave(0)}>None left</Button>
      <Button variant="quiet" onClick={onSkip}>{skipLabel}</Button>
    </form>
  )
}
