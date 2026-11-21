import type { MeterState } from '../lib/stamina'
import { Button } from './ui'

// STA-7: update a stamina meter straight from its Today card, the same as on the game page: one tap for
// what you just spent (each meter's own amounts, e.g. 20 / 40 / 60 Resin), "Set" for what the game shows.
// A spend can be undone for a few seconds, as a mistap now changes your number in one go.
export function MeterQuick({ meter, spends, undo, onSpend, onSet, onUndo }: {
  meter: MeterState
  spends: number[]
  undo: number | null // the amount just spent, while it can still be undone
  onSpend: (amount: number) => void
  onSet: () => void
  onUndo: () => void
}) {
  return (
    <div className="gc-quick relative z-[1] mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={`Update ${meter.name}`}>
      {spends.map((n) => (
        <Button key={n} size="sm" variant="secondary" className="px-2.5 tabular-nums" onClick={() => onSpend(n)} aria-label={`Spent ${n} ${meter.name}`}>
          −{n}
        </Button>
      ))}
      <Button size="sm" variant="secondary" className="px-2.5" onClick={onSet} aria-label={`Set ${meter.name} to what the game shows`}>
        Set
      </Button>
      {/* Announced when it appears, so a screen reader hears that the spend went through */}
      <span role="status" className="ml-auto text-xs">
        {undo !== null && (
          <span className="flex items-center gap-1.5">
            <span className="text-muted">−{undo} saved</span>
            <Button size="sm" variant="link" onClick={onUndo} aria-label={`Undo spending ${undo} ${meter.name}`}>Undo</Button>
          </span>
        )}
      </span>
    </div>
  )
}
