import { useCallback, useEffect, useState } from 'react'
import { PRESETS, findPreset, findServer, type GamePreset } from '../data/presets'
import { addGameFromPreset, changeServer, deleteGame, loadGames, setPingAt, type GameSummary } from '../lib/games'
import { messageOf } from '../lib/errors'
import { useRefreshOnFocus } from '../lib/useRefreshOnFocus'
import TaskManager from './TaskManager'
import CharacterPictures from './CharacterPictures'
import { fetchCharacterImages, type CharacterImage } from '../lib/characterImages'
import { pingThreshold } from '../lib/stamina'
import { Button, Card, Input, Notice, Select, useConfirm } from './ui'

export default function GamesScreen() {
  const [games, setGames] = useState<GameSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [serverChoice, setServerChoice] = useState<Record<string, string>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [picsOpenId, setPicsOpenId] = useState<string | null>(null)
  const [images, setImages] = useState<Record<string, CharacterImage[]>>({})
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

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">My games</h2>
        {loading && <Notice>Loading…</Notice>}
        {!loading && games.length === 0 && <Notice>No games yet. Add one below.</Notice>}

        {games.map((game) => {
          const preset = findPreset(game.preset_id)
          const server = findServer(preset, game.server)
          const active = game.tasks.filter((t) => !t.archived)
          const visible = active.filter((t) => !t.hidden)
          const routine = (rule: string) =>
            visible.filter((t) => t.category === 'routine' && t.frequency === rule).length
          const endgameCount = visible.filter((t) => t.category === 'endgame').length
          const hiddenCount = active.length - visible.length
          const summary = `${routine('daily')} daily · ${routine('weekly')} weekly · ${routine('monthly')} monthly · ${endgameCount} endgame${hiddenCount ? ` · ${hiddenCount} hidden` : ''}`
          return (
            <Card as="article" key={game.id} padding="md" className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="font-semibold">{game.name}</h3>
                  <p className="text-xs text-muted">
                    Resets {game.daily_reset_time.slice(0, 5)} server time · {summary}
                  </p>
                </div>
                <Button variant="secondary" className="shrink-0" onClick={() => void handleDelete(game)} disabled={busyId !== null}>
                  Delete
                </Button>
              </div>

              {preset ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                  <label htmlFor={`server-${game.id}`}>Server</label>
                  <Select id={`server-${game.id}`} value={game.server ?? ''} disabled={busyId !== null}
                    onChange={(e) => void run(game.id, () => changeServer(game.id, preset, e.target.value))}>
                    {!server && <option value={game.server ?? ''}>{game.server ?? 'Choose…'}</option>}
                    {preset.servers.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </Select>
                </div>
              ) : (
                <Notice>Server: {game.server ?? 'None'}</Notice>
              )}
              {server?.note && <p className="text-xs text-urgent">{server.note}</p>}

              {game.stamina_meters.length > 0 && (
                <ul className="space-y-2 text-sm">
                  {game.stamina_meters.map((meter) => {
                    const parent = game.stamina_meters.find((m) => m.id === meter.fills_when_full_of)
                    return (
                      <li key={meter.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <span>
                          {meter.name}: cap {meter.cap}, 1 per {meter.minutes_per_point} min
                          {parent && <span className="text-muted"> · overflow from {parent.name}</span>}
                        </span>
                        {/* Overflow meters never ping, so they have no threshold */}
                        {!parent && (
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
              )}
              <Button
                variant="link"
                aria-expanded={openId === game.id}
                onClick={() => setOpenId(openId === game.id ? null : game.id)}
              >
                {openId === game.id ? 'Hide tasks' : `Manage tasks (${active.length})`}
              </Button>
              {openId === game.id && <TaskManager game={game} onChanged={refresh} />}
              <Button
                variant="link"
                aria-expanded={picsOpenId === game.id}
                onClick={() => setPicsOpenId(picsOpenId === game.id ? null : game.id)}
              >
                {picsOpenId === game.id ? 'Hide character pictures' : `Character pictures (${images[game.id]?.length ?? 0})`}
              </Button>
              {picsOpenId === game.id && (
                <CharacterPictures gameId={game.id} gameName={game.name} images={images[game.id] ?? []} onChanged={refreshImages} />
              )}
            </Card>
          )
        })}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Add a game</h2>
        {loading ? null : notAdded.length === 0 ? (
          <Notice>Every supported game is added.</Notice>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {notAdded.map((preset) => {
              const chosen = serverChoice[preset.id] ?? preset.defaultServer
              return (
                <Card as="article" key={preset.id} padding="md" className="flex flex-col gap-3">
                  <div className="space-y-1">
                    <h3 className="font-semibold">{preset.name}</h3>
                    <p className="text-xs text-muted">
                      {preset.meters.length} meter{preset.meters.length === 1 ? '' : 's'} · {preset.tasks.length} tasks
                    </p>
                  </div>
                  <label className="sr-only" htmlFor={`new-server-${preset.id}`}>Server for {preset.name}</label>
                  <Select id={`new-server-${preset.id}`} value={chosen} disabled={busyId !== null}
                    onChange={(e) => setServerChoice((prev) => ({ ...prev, [preset.id]: e.target.value }))}>
                    {preset.servers.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </Select>
                  <Button variant="primary" full onClick={() => handleAdd(preset)} disabled={busyId !== null}>
                    {busyId === preset.id ? 'Adding…' : 'Add'}
                  </Button>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {error && <Notice tone="error">{error}</Notice>}
    </div>
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
    <span className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-2 text-muted">
        <label htmlFor={id}>Ping at</label>
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
          className="w-24"
        />
        <span id={`${id}-hint`}>of {cap}{value === null ? ' (default 90%)' : ''}<span className="sr-only">, {name}</span></span>
      </span>
      {problem && <span role="alert" className="text-xs text-urgent">{problem}</span>}
    </span>
  )
}
