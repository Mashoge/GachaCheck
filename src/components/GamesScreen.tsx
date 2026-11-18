import { useCallback, useEffect, useRef, useState } from 'react'
import { PRESETS, findPreset, findServer, type GamePreset } from '../data/presets'
import { addGameFromPreset, changeServer, deleteGame, loadGames, setPingAt, type GameSummary } from '../lib/games'
import { messageOf } from '../lib/errors'
import { useRefreshOnFocus } from '../lib/useRefreshOnFocus'
import TaskManager from './TaskManager'
import CharacterPictures from './CharacterPictures'
import { ACCEPT, MAX_PER_GAME, fetchCharacterImages, removeGameIcon, setGameIcon, type CharacterImage } from '../lib/characterImages'
import { useGameIcons } from '../lib/useGameIcons'
import { GameIcon } from './GameIcon'
import { pingThreshold } from '../lib/stamina'
import { formatDuration } from '../lib/time'
import { Button, ChevronIcon, EditIcon, Input, Loading, Notice, PageTitle, Select, SheetRow, Switch, useConfirm } from './ui'
import { setDataSaver, useDataSaver } from '../lib/dataSaver'

export default function GamesScreen() {
  const [games, setGames] = useState<GameSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [serverChoice, setServerChoice] = useState<Record<string, string>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [picsOpenId, setPicsOpenId] = useState<string | null>(null)
  const [images, setImages] = useState<Record<string, CharacterImage[]>>({})
  const icons = useGameIcons(games)
  const confirm = useConfirm()

  useEffect(() => {
    let cancelled = false
    loadGames()
      .then((data) => {
        if (!cancelled) setGames(data)
      })
      .catch((err) => {
        if (!cancelled) setError(messageOf(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    // LTR-8: pictures are optional; if they fail to load, the rest of the screen still works
    fetchCharacterImages()
      .then((list) => {
        if (!cancelled) setImages(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const refreshImages = useCallback(async () => {
    setImages(await fetchCharacterImages())
  }, [])

  const refresh = useCallback(async () => {
    try {
      setGames(await loadGames())
      setError(null)
    } catch (err) {
      setError(messageOf(err))
      throw err
    }
  }, [])
  useRefreshOnFocus(refresh)

  async function run(id: string, action: () => Promise<void>) {
    setBusyId(id)
    setError(null)
    try {
      await action()
      await refresh()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusyId(null)
    }
  }

  function handleAdd(preset: GamePreset) {
    const serverId = serverChoice[preset.id] ?? preset.defaultServer
    void run(preset.id, () => addGameFromPreset(preset, serverId, games.length))
  }

  async function handleDelete(game: GameSummary) {
    const ok = await confirm({
      title: `Delete ${game.name}?`,
      message: 'Its tasks and history are removed too. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (ok) void run(game.id, () => deleteGame(game.id))
  }

  const addedPresetIds = new Set(games.map((g) => g.preset_id))
  // Only games you don't have yet; a deleted game shows up here again
  const notAdded = PRESETS.filter((p) => !addedPresetIds.has(p.id))

  // THM-9 (step 3): the Today page's voice here too. Spaced labels, slanted tags, hairline rows and
  // each game's own colour, on a settings sheet: a label column on the left, the settings on the right.
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <PageTitle>Games</PageTitle>
        <p className="text-sm text-muted">Servers, stamina pings, tasks and pictures</p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid items-start gap-x-6 gap-y-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="my-games" className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 id="my-games" className="text-base font-semibold">My games</h2>
            {!loading && games.length > 0 && (
              <span className="gc-tag" data-tone="rest">{games.length} of {PRESETS.length}</span>
            )}
          </div>
          {loading && <Loading />}
          {!loading && games.length === 0 && <Notice>No games yet. Add one from the list.</Notice>}

          {games.map((game) => {
            const preset = findPreset(game.preset_id)
            const server = findServer(preset, game.server)
            const active = game.tasks.filter((t) => !t.archived)
            const visible = active.filter((t) => !t.hidden)
            const routine = (rule: string) =>
              visible.filter((t) => t.category === 'routine' && t.frequency === rule).length
            const counts = [
              { label: 'Daily', n: routine('daily') },
              { label: 'Weekly', n: routine('weekly') },
              { label: 'Monthly', n: routine('monthly') },
              { label: 'Endgame', n: visible.filter((t) => t.category === 'endgame').length },
            ].filter((c) => c.n > 0)
            const hiddenCount = active.length - visible.length
            const pictureCount = images[game.id]?.length ?? 0
            const tasksOpen = openId === game.id
            const picsOpen = picsOpenId === game.id
            return (
              <article key={game.id} data-game={game.preset_id ?? undefined}
                className="gc-set min-w-0 overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
                  <IconPicker
                    game={game}
                    url={icons[game.id] ?? null}
                    disabled={busyId !== null}
                    onSet={(file) => void run(game.id, () => setGameIcon(game, file))}
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold leading-tight">{game.name}</h3>
                    <p className="mt-1 text-xs text-muted">
                      Resets {game.daily_reset_time.slice(0, 5)} server time · weekly on {WEEKDAYS[game.weekly_reset_day % 7]}
                    </p>
                  </div>
                  {preset ? (
                    <div className="flex items-center gap-3 max-sm:basis-full">
                      <label htmlFor={`server-${game.id}`} className="gc-label">Server</label>
                      <Select id={`server-${game.id}`} value={game.server ?? ''} disabled={busyId !== null} className="min-w-0 max-sm:flex-1"
                        onChange={(e) => void run(game.id, () => changeServer(game.id, preset, e.target.value))}>
                        {!server && <option value={game.server ?? ''}>{game.server ?? 'Choose…'}</option>}
                        {preset.servers.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </Select>
                    </div>
                  ) : (
                    <span className="gc-tag" data-tone="rest">Server: {game.server ?? 'None'}</span>
                  )}
                  {server?.note && <p className="basis-full text-xs text-urgent">{server.note}</p>}
                </div>

                {game.stamina_meters.length > 0 && (
                  <SheetRow level={4} label="Stamina">
                    <ul className="divide-y divide-line">
                      {game.stamina_meters.map((meter) => {
                        const parent = game.stamina_meters.find((m) => m.id === meter.fills_when_full_of)
                        return (
                          <li key={meter.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold"><span aria-hidden="true" className="gc-tick" />{meter.name}</p>
                              <p className="text-xs text-muted">
                                Cap {meter.cap} · 1 every {meter.minutes_per_point} min · empty to full in {formatDuration(meter.cap * meter.minutes_per_point * 60_000)}
                              </p>
                            </div>
                            {/* Overflow meters never ping, so they have no threshold */}
                            {parent ? (
                              <span className="gc-tag" data-tone="rest">Overflow from {parent.name}</span>
                            ) : (
                              <PingAtField
                                key={`${meter.id}:${meter.ping_at ?? ''}`}
                                id={`ping-${meter.id}`}
                                name={meter.name}
                                cap={meter.cap}
                                value={meter.ping_at}
                                disabled={busyId !== null}
                                onSave={(v) => void run(game.id, () => setPingAt(meter.id, v))}
                              />
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </SheetRow>
                )}

                <SheetRow level={4} label="Tasks">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <ul className="flex flex-wrap items-baseline gap-x-5 gap-y-1" aria-label={`${game.name} tasks`}>
                      {counts.map((c) => (
                        <li key={c.label} className="flex items-baseline gap-1.5">
                          <span className="font-display text-lg font-semibold leading-none">{c.n}</span>
                          <span className="gc-label">{c.label}</span>
                        </li>
                      ))}
                      {counts.length === 0 && <li className="text-sm text-muted">None shown</li>}
                      {hiddenCount > 0 && <li><span className="gc-tag" data-tone="rest">{hiddenCount} hidden</span></li>}
                    </ul>
                    <Toggle open={tasksOpen} onClick={() => setOpenId(tasksOpen ? null : game.id)}
                      label={tasksOpen ? 'Hide tasks' : 'Manage tasks'} gameName={game.name} />
                  </div>
                  {tasksOpen && <div className="mt-3"><TaskManager game={game} onChanged={refresh} /></div>}
                </SheetRow>

                <SheetRow level={4} label="Pictures">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <p className="flex items-baseline gap-1.5">
                      <span className="font-display text-lg font-semibold leading-none">{pictureCount}</span>
                      <span className="gc-label">of {MAX_PER_GAME}</span>
                      <span className="text-xs text-muted">· shown when the Today card wakes</span>
                    </p>
                    <Toggle open={picsOpen} onClick={() => setPicsOpenId(picsOpen ? null : game.id)}
                      label={picsOpen ? 'Hide pictures' : 'Manage pictures'} gameName={game.name} />
                  </div>
                  {picsOpen && (
                    <div className="mt-3">
                      <CharacterPictures gameId={game.id} gameName={game.name} images={images[game.id] ?? []} onChanged={refreshImages} />
                    </div>
                  )}
                </SheetRow>

                <div className="flex flex-wrap items-center justify-end gap-1 border-t border-line px-2 py-0.5">
                  {game.icon_path && (
                    <Button variant="quiet" size="sm" disabled={busyId !== null} onClick={() => void run(game.id, () => removeGameIcon(game))}
                      aria-label={`Remove the icon for ${game.name}`}>
                      Remove icon
                    </Button>
                  )}
                  <Button variant="quiet" size="sm" className="hover:text-urgent" onClick={() => void handleDelete(game)} disabled={busyId !== null}
                    aria-label={`Delete ${game.name}`}>
                    Delete game
                  </Button>
                </div>
              </article>
            )
          })}
        </section>

        <div className="flex min-w-0 flex-col gap-8">
          <section aria-labelledby="add-game" className="flex flex-col gap-3">
            <h2 id="add-game" className="text-base font-semibold">Add a game</h2>
            {loading ? null : notAdded.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line px-4 py-3 text-sm text-muted">
                Every supported game is added. A game you delete comes back here.
              </p>
            ) : (
              notAdded.map((preset) => {
                const chosen = serverChoice[preset.id] ?? preset.defaultServer
                return (
                  <article key={preset.id} data-game={preset.id} className="gc-set rounded-2xl border border-line bg-surface p-4">
                    <div className="flex items-center gap-3">
                      <GameIcon presetId={preset.id} size={36} />
                      <div className="min-w-0">
                        <h3 className="font-semibold leading-tight">{preset.name}</h3>
                        <p className="mt-0.5 text-xs text-muted">
                          {preset.meters.length} meter{preset.meters.length === 1 ? '' : 's'} · {preset.tasks.length} tasks
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <label className="sr-only" htmlFor={`new-server-${preset.id}`}>Server for {preset.name}</label>
                      <Select id={`new-server-${preset.id}`} value={chosen} disabled={busyId !== null} className="min-w-0 flex-1"
                        onChange={(e) => setServerChoice((prev) => ({ ...prev, [preset.id]: e.target.value }))}>
                        {preset.servers.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </Select>
                      <Button variant="primary" onClick={() => handleAdd(preset)} disabled={busyId !== null} aria-label={`Add ${preset.name}`}>
                        {busyId === preset.id ? 'Adding…' : 'Add'}
                      </Button>
                    </div>
                  </article>
                )
              })
            )}
          </section>

          <DeviceSettings />
        </div>
      </div>
    </div>
  )
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Opens or closes a panel under its row; the chevron turns down while open. Stays on the right when it wraps. */
function Toggle({ open, label, gameName, onClick }: { open: boolean; label: string; gameName: string; onClick: () => void }) {
  return (
    <Button size="sm" className="ml-auto" aria-expanded={open} aria-label={`${label}, ${gameName}`} onClick={onClick}>
      {label}
      <span className={`transition-transform ${open ? 'rotate-90' : ''}`}><ChevronIcon size={14} /></span>
    </Button>
  )
}

// LTR-8: your own icon for this game. Cut to the middle square and shown as a circle; without one the
// game keeps its coloured badge. Private to your account, like character pictures. Removing it is in
// the card's footer.
function IconPicker({ game, url, disabled, onSet }: {
  game: GameSummary
  url: string | null
  disabled: boolean
  onSet: (file: File) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        aria-label={`${game.icon_path ? 'Change' : 'Choose'} the icon for ${game.name}`}
        title={game.icon_path ? 'Change icon' : 'Choose an icon'}
        className="group relative shrink-0 rounded-full disabled:opacity-50"
      >
        <GameIcon presetId={game.preset_id} url={url} size={48} className="transition-opacity group-hover:opacity-80" />
        <span aria-hidden="true" className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full border border-line bg-raised text-muted transition-colors group-hover:text-ink">
          <EditIcon size={11} />
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onSet(file)
        }}
      />
    </>
  )
}

// THM-7: settings that belong to this device rather than your account (a phone on mobile data and a PC
// on Wi-Fi can differ).
function DeviceSettings() {
  const { on, choice, browserAsks } = useDataSaver()
  const why = choice !== null
    ? null
    : browserAsks ? 'On because your browser asked to save data.' : 'Follows your browser, which is not asking to save data.'
  return (
    <section className="flex flex-col gap-3" aria-labelledby="device-settings">
      <h2 id="device-settings" className="text-base font-semibold">On this device</h2>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-4">
          <h3 className="gc-label">Data saver</h3>
          <Switch label="Data saver" on={on} onChange={(next) => setDataSaver(next ? 'on' : 'off')} />
        </div>
        <p className="mt-2 text-sm text-muted">
          Turns off your character pictures and the cards&apos; decorative animation, so GachaCheck stays light on a
          slow or metered connection. Numbers, countdowns and buttons stay the same.
        </p>
        <div className="mt-3 border-t border-line pt-2">
          {why ? (
            <p className="py-1 text-xs text-muted">{why}</p>
          ) : (
            <Button variant="link" size="sm" onClick={() => setDataSaver(null)}>
              Follow my browser&apos;s setting instead
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}

// SUP-3: "Ping me at N" for one meter. Blank = the default (90% of the cap). Saves on Enter or when leaving the field.
function PingAtField({ id, name, cap, value, disabled, onSave }: {
  id: string; name: string; cap: number; value: number | null; disabled: boolean; onSave: (value: number | null) => void
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  const [problem, setProblem] = useState<string | null>(null)
  const fallback = pingThreshold({ cap })

  const commit = () => {
    const text = draft.trim()
    const next = text === '' ? null : Number(text)
    if (next !== null && (!Number.isInteger(next) || next < 1 || next > cap)) {
      setProblem(`Use a whole number from 1 to ${cap}, or leave it empty for ${fallback}.`)
      return
    }
    setProblem(null)
    if (next !== value) onSave(next)
  }

  return (
    <span className="ml-auto flex flex-col items-end gap-1">
      <span className="flex items-center gap-2 text-sm text-muted">
        <label htmlFor={id} className="gc-label">Ping at</label>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={cap}
          value={draft}
          placeholder={String(fallback)}
          disabled={disabled}
          aria-describedby={`${id}-hint`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
          className="w-20"
        />
        <span id={`${id}-hint`} className="flex items-center gap-2 whitespace-nowrap">
          / {cap}
          {value === null && <span className="gc-tag">Default 90%</span>}
          <span className="sr-only">, {name}</span>
        </span>
      </span>
      {problem && <span role="alert" className="text-xs text-urgent">{problem}</span>}
    </span>
  )
}
