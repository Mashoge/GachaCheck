import { useEffect, useState } from 'react'
import { PRESETS, findPreset, findServer, type GamePreset } from '../data/presets'
import { addGameFromPreset, changeServer, deleteGame, loadGames, type GameSummary } from '../lib/games'
import { messageOf } from '../lib/errors'
import TaskManager from './TaskManager'

const selectClass =
  'min-h-10 rounded-lg border border-line bg-page px-2 text-sm text-ink outline-none [color-scheme:dark] focus:border-accent disabled:opacity-50'

export default function GamesScreen() {
  const [games, setGames] = useState<GameSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [serverChoice, setServerChoice] = useState<Record<string, string>>({})
  const [openId, setOpenId] = useState<string | null>(null)

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

  function handleDelete(game: GameSummary) {
    if (!window.confirm(`Delete ${game.name}? Its tasks and history are removed too.`)) return
    void run(game.id, () => deleteGame(game.id))
  }

  const addedPresetIds = new Set(games.map((g) => g.preset_id))
  // Only games you don't have yet; a deleted game shows up here again
  const notAdded = PRESETS.filter((p) => !addedPresetIds.has(p.id))

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">My games</h2>
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && games.length === 0 && (
          <p className="text-sm text-muted">No games yet. Add one below.</p>
        )}

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
            <article key={game.id} className="space-y-3 rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="font-semibold">{game.name}</h3>
                  <p className="text-xs text-muted">
                    Resets {game.daily_reset_time.slice(0, 5)} server time · {summary}
                  </p>
                </div>
                <button type="button" onClick={() => handleDelete(game)} disabled={busyId !== null}
                  className="min-h-10 shrink-0 rounded-lg border border-line px-3 text-sm text-muted hover:text-urgent disabled:opacity-50">
                  Delete
                </button>
              </div>

              {preset ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                  <label htmlFor={`server-${game.id}`}>Server</label>
                  <select id={`server-${game.id}`} value={game.server ?? ''} disabled={busyId !== null}
                    onChange={(e) => void run(game.id, () => changeServer(game.id, preset, e.target.value))}
                    className={selectClass}>
                    {!server && <option value={game.server ?? ''}>{game.server ?? 'Choose…'}</option>}
                    {preset.servers.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-sm text-muted">Server: {game.server ?? 'None'}</p>
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
              <button
                type="button"
                aria-expanded={openId === game.id}
                onClick={() => setOpenId(openId === game.id ? null : game.id)}
                className="min-h-9 text-sm font-medium text-accent hover:underline"
              >
                {openId === game.id ? 'Hide tasks' : `Manage tasks (${active.length})`}
              </button>
              {openId === game.id && <TaskManager game={game} onChanged={refresh} />}
            </article>
          )
        })}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Add a game</h2>
        {loading ? null : notAdded.length === 0 ? (
          <p className="text-sm text-muted">Every supported game is added.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {notAdded.map((preset) => {
              const chosen = serverChoice[preset.id] ?? preset.defaultServer
              return (
                <article key={preset.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
                  <div className="space-y-1">
                    <h3 className="font-semibold">{preset.name}</h3>
                    <p className="text-xs text-muted">
                      {preset.meters.length} meter{preset.meters.length === 1 ? '' : 's'} · {preset.tasks.length} tasks
                    </p>
                  </div>
                  <label className="sr-only" htmlFor={`new-server-${preset.id}`}>Server for {preset.name}</label>
                  <select id={`new-server-${preset.id}`} value={chosen} disabled={busyId !== null}
                    onChange={(e) => setServerChoice((prev) => ({ ...prev, [preset.id]: e.target.value }))}
                    className={selectClass}>
                    {preset.servers.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => handleAdd(preset)} disabled={busyId !== null}
                    className="min-h-10 rounded-xl bg-accent text-sm font-semibold text-on-accent disabled:opacity-60">
                    {busyId === preset.id ? 'Adding…' : 'Add'}
                  </button>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {error && <p role="alert" className="text-sm text-urgent">{error}</p>}
    </div>
  )
}