import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import type { GameEvent } from '../../lib/events'
import { eventFacts } from '../../lib/eventFacts'
import type { Game } from '../../lib/today'
import { Button, CloseIcon } from '../../components/ui'
import { EventCard } from './EventDisplay'

// EVT-14: an event's full details, opened by clicking it on the path (or a bar): its card, with the
// buttons (Event page, Mark done, Edit), and the facts under it (eventFacts).
// Wide screens: a panel beside the path that stays put while you scroll; clicking another event switches
// it, Escape or ✕ closes it. Phones and tablets: a sheet rising from the bottom, over a dimmed page,
// built on the browser's own <dialog> (focus stays inside, Escape closes, focus goes back afterwards).

type Props = {
  event: GameEvent
  game: Game | undefined
  iconUrl?: string
  pictureUrl?: string
  now: Date
  /** Beside the path (wide screens) rather than a sheet from the bottom */
  docked: boolean
  onClose: () => void
  onEdit: () => void
  onDone: (done: boolean) => void
}

export function EventDetails({ event, game, iconUrl, pictureUrl, now, docked, onClose, onEdit, onDone }: Props) {
  const titleId = useId()
  const sheet = useRef<HTMLDialogElement>(null)
  // A sheet closes through the dialog itself, so the browser puts focus back where it was
  const close = () => (sheet.current?.open ? sheet.current.close() : onClose())

  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="gc-label">Event details</h2>
        <Button size="sm" variant="quiet" icon onClick={close} aria-label="Close details">
          <CloseIcon size={16} />
        </Button>
      </div>
      <EventCard
        event={event}
        game={game}
        iconUrl={iconUrl}
        pictureUrl={pictureUrl}
        now={now}
        onDone={onDone}
        onEdit={() => {
          // The form opens at the top of the page; the details step aside for it
          sheet.current?.close()
          onEdit()
        }}
      />
      <dl className="gc-facts">
        {eventFacts(event, now).map((f) => (
          <div key={f.label} className="contents">
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
    </>
  )

  return docked ? (
    <Docked titleId={titleId} onClose={onClose}>{body}</Docked>
  ) : (
    <dialog
      ref={sheet}
      aria-labelledby={titleId}
      className="gc-sheet"
      onClose={onClose}
      // A tap on the dimmed page above the sheet closes it
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <OpenOnMount dialog={sheet} />
      <span aria-hidden="true" className="gc-sheet-grab" />
      {body}
    </dialog>
  )
}

/** Opens the sheet as a modal once it's on the page */
function OpenOnMount({ dialog }: { dialog: RefObject<HTMLDialogElement | null> }) {
  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
  }, [dialog])
  return null
}

/** The panel beside the path: takes focus when it opens, gives it back when it closes, closes on Escape */
function Docked({ titleId, onClose, children }: { titleId: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.focus({ preventScroll: true })
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <aside ref={panel} tabIndex={-1} aria-labelledby={titleId} className="gc-details">
      {children}
    </aside>
  )
}
