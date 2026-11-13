import { useEffect, useState } from 'react'
import { PRESETS, findPreset, findServer, type GamePreset } from '../data/presets'
import { addGameFromPreset, changeServer, deleteGame, loadGames, type GameSummary } from '../lib/games'
import { messageOf } from '../lib/errors'
import TaskManager from './TaskManager'
import { Button, Card, Notice, Select, useConfirm } from './ui'

export default function GamesScreen() {
  const [games, setGames] = useState<GameSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [serverChoice, setServerChoice] = useState<Record<string, string>>({})
  const [openId, setOpenId] = useState<string | null>(null)
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
    return () => {
      cancelled = true
    }
  }, [])

  async function refresh() {
    setGames(await loadGames())
  }

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
                <ul className="space-y-1 text-sm">
                  {game.stamina_meters.map((meter) => {
                    const parent = game.stamina_meters.find((m) => m.id === meter.fills_when_full_of)
                    return (
                      <li key={meter.id}>
                        {meter.name}: cap {meter.cap}, 1 per {meter.minutes_per_point} min
                        {parent && <span className="text-muted"> · overflow from {parent.name}</span>}
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