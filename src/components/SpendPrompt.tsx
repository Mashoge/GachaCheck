import { useState } from 'react'
import type { MeterState } from '../lib/stamina'

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
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={`0–${meter.cap}`}
        className="min-h-10 w-28 rounded-lg border border-line bg-page px-3 text-sm text-ink placeholder:text-muted"
      />
      <button type="submit" disabled={!valid} className="min-h-10 rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent disabled:opacity-40">Save</button>
      <button type="button" onClick={() => onSave(0)} className="min-h-10 rounded-lg border border-line px-3 text-sm font-semibold text-muted hover:text-ink">None left</button>
      <button type="button" onClick={onSkip} className="min-h-10 rounded-lg px-2 text-sm text-muted hover:text-ink">Skip</button>
    </form>
  )
}
