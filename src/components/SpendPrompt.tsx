import { useState } from 'react'
import type { MeterState } from '../lib/stamina'
import { Button, Input } from './ui'

// Asks what a stamina meter shows now. Shown under a "Spend …" task right after it is ticked,
// and after "All done" on the game page and on Today.
export default function SpendPrompt({ meter, onSave, onSkip }: { meter: MeterState; onSave: (value: number) => void; onSkip: () => void }) {
  const [draft, setDraft] = useState('')
  const id = `spent-${meter.id}`
  const value = Number(draft)
  const valid = draft.trim() !== '' && Number.isFinite(value) && value >= 0

  return (
    <form
      className="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-3 py-2.5"
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
        placeholder={`0–${meter.cap}`}
        className="w-28"
      />
      <Button type="submit" variant="primary" disabled={!valid}>Save</Button>
      <Button onClick={() => onSave(0)}>None left</Button>
      <Button variant="quiet" onClick={onSkip}>Skip</Button>
    </form>
  )
}
