import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import {
  ACCEPT, MAX_PER_GAME, addCharacterImage, fileProblem, focusFromPoint, nudgeFocus, removeCharacterImage, roomFor,
  setImageFocus, type CharacterImage,
} from '../lib/characterImages'
import { messageOf } from '../lib/errors'
import { Button, Notice, useConfirm } from './ui'

// LTR-8: add, remove and frame your own character pictures for one game (Games screen).
// Each picture is shown whole; click a spot (or use the arrow keys) to choose the part the Today card
// keeps in view when it crops the picture (focus_x / focus_y, used as CSS object-position).
export default function CharacterPictures({ gameId, gameName, images, onChanged }: {
  gameId: string
  gameName: string
  images: CharacterImage[]
  onChanged: () => Promise<void>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()
  const room = MAX_PER_GAME - images.length

  async function add(files: File[]) {
    setProblems([])
    const usable: File[] = []
    const found: string[] = []
    for (const f of files) {
      const problem = fileProblem(f)
      if (problem) found.push(problem)
      else usable.push(f)
    }
    const fits = roomFor(images.length, usable.length)
    if (fits < usable.length) found.push(`Only ${fits} more ${fits === 1 ? 'picture fits' : 'pictures fit'} (${MAX_PER_GAME} per game).`)
    const todo = usable.slice(0, fits)
    if (todo.length === 0) {
      setProblems(found)
      return
    }
    setBusy(true)
    let order = images.reduce((max, img) => Math.max(max, img.sortOrder + 1), 0)
    for (const [i, file] of todo.entries()) {
      setStatus(`Adding ${i + 1} of ${todo.length}…`)
      try {
        await addCharacterImage(gameId, file, order++)
      } catch (err) {
        found.push(`${file.name}: ${messageOf(err)}`)
      }
    }
    setStatus(null)
    setProblems(found)
    await onChanged().catch(() => {})
    setBusy(false)
  }

  async function remove(image: CharacterImage, n: number) {
    const ok = await confirm({
      title: `Remove picture ${n}?`,
      message: `It is deleted from your ${gameName} pictures. This cannot be undone.`,
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await removeCharacterImage(image)
      await onChanged()
    } catch (err) {
      setProblems([messageOf(err)])
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby={`pics-${gameId}`} className="space-y-3 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 id={`pics-${gameId}`} className="text-sm font-semibold">Character pictures</h4>
        <span className="text-xs text-muted">{images.length} of {MAX_PER_GAME}</span>
      </div>
      <p className="text-xs text-muted">
        Your own screenshots, shown on this game&apos;s Today card when you point at it, one after another.
        Only you can see them. Click a picture, or focus it and use the arrow keys, to choose the part to keep in view.
      </p>

      {images.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((img, i) => (
            <li key={img.id} className="flex flex-col items-center gap-1">
              <FocusPicker image={img} n={i + 1} total={images.length} disabled={busy} onError={(m) => setProblems([m])} />
              <Button variant="link" size="sm" disabled={busy} onClick={() => void remove(img, i + 1)}
                aria-label={`Remove picture ${i + 1}`}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={busy || room <= 0} onClick={() => input.current?.click()}>
          Add pictures
        </Button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = '' // choosing the same file again still works
            if (files.length) void add(files)
          }}
        />
        <span className="text-xs text-muted" role="status">
          {status ?? (room <= 0 ? `This game has the most pictures it can have (${MAX_PER_GAME}).` : 'PNG, JPEG or WebP, shrunk before upload.')}
        </span>
      </div>
      {problems.length > 0 && (
        <Notice tone="error">
          {problems.map((p) => <span key={p} className="block">{p}</span>)}
        </Notice>
      )}
    </section>
  )
}

function FocusPicker({ image, n, total, disabled, onError }: {
  image: CharacterImage
  n: number
  total: number
  disabled: boolean
  onError: (message: string) => void
}) {
  const [focus, setFocus] = useState({ x: image.focusX, y: image.focusY })
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Save shortly after the last change, so holding an arrow key is one save, not twenty
  function change(next: { x: number; y: number }) {
    setFocus(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setImageFocus(image.id, next).catch((err) => onError(messageOf(err)))
    }, 400)
  }

  return (
    <button
      type="button"
      disabled={disabled}
      className="block w-full overflow-hidden rounded-md border border-line bg-raised"
      aria-label={`Picture ${n} of ${total}. Kept in view: ${focus.x}% from the left, ${focus.y}% from the top. Click a spot or use the arrow keys to move it.`}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        // A keyboard "click" (Enter/Space) has no position; arrow keys move the point instead
        const img = e.currentTarget.querySelector('img')
        if (e.detail === 0 || !img) return
        const point = focusFromPoint(e.clientX, e.clientY, img.getBoundingClientRect())
        if (point) change(point)
      }}
      onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
        const next = nudgeFocus(focus, e.key, e.shiftKey)
        if (next) {
          e.preventDefault()
          change(next)
        }
      }}
    >
      {image.url ? (
        // The whole picture, so the spot you click is the spot kept in view on the card
        <span className="relative block">
          <img src={image.url} alt="" draggable={false} className="block h-auto w-full" />
          <span aria-hidden="true" className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
            style={{ left: `${focus.x}%`, top: `${focus.y}%` }} />
        </span>
      ) : (
        <span className="block p-3 text-xs text-muted">Not available</span>
      )}
    </button>
  )
}
