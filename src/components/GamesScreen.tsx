import { useEffect, useState } from 'react'
import { PRESETS, type GamePreset } from '../data/presets'
import { addGameFromPreset, deleteGame, fetchGames, type GameSummary } from '../lib/games'

function messageOf(err: unknown) {
  return (err as { message?: string })?.message ?? 'Something went wrong'
}

export default function GamesScreen() {
  const [games, setGames] = useState<GameSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchGames().then(({ data, error }) => {
      if (cancelled) return
      if (error) setError(error.message)
      else setGames(data)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function refresh() {
    const { data, error } = await fetchGames()
    if (error) setError(error.message)
    else setGames(data)
  }

  async function handleAdd(preset: GamePreset) {
    setBusyId(preset.id)
    setError(null)
    try {
      await addGameFromPreset(preset, games.length)
      await refresh()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(game: GameSummary) {
    if (!window.confirm(`Delete ${game.name}? Its tasks and history are removed too.`)) return
    setBusyId(game.id)
    setError(null)
    try {
      await deleteGame(game.id)
      await refresh()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusyId(null)
    }
  }

  const addedPresetIds = new Set(games.map((g) => g.preset_id))

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">My games</h2>
        {loading && <p className="text-sm text-[#9AA1B2]">Loading…</p>}
        {!loading && games.length === 0 && (
          <p className="text-sm text-[#9AA1B2]">No games yet. Add one from the presets below.</p>
        )}

        {games.map((game) => {
          const activeTasks = game.tasks.filter((t) => !t.archived)
          const daily = activeTasks.filter((t) => t.frequency === 'daily').length
          const weekly = activeTasks.length - daily
          return (
            <article key={game.id} className="space-y-3 rounded-2xl border border-[#262B39] bg-[#161922] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="font-semibold">{game.name}</h3>
                  <p className="text-xs text-[#9AA1B2]">
                    {game.server ?? 'No server'} · resets {game.daily_reset_time.slice(0, 5)} · {daily} daily,{' '}
                    {weekly} weekly tasks
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete(game)}
                  disabled={busyId !== null}
                  className="h-9 rounded-lg border border-[#3A4052] px-3 text-sm text-[#FF8A8A] disabled:opacity-50"
                >
                  Delete
                </button>
              </div>

              {game.stamina_meters.length > 0 && (
                <ul className="space-y-1 text-sm text-[#C9CDD8]">
                  {game.stamina_meters.map((meter) => {
                    const parent = game.stamina_meters.find((m) => m.id === meter.fills_when_full_of)
                    return (
                      <li key={meter.id}>
                        {meter.name}: cap {meter.cap}, 1 per {meter.minutes_per_point} min
                        {parent && <span className="text-[#9AA1B2]"> · overflow from {parent.name} is full</span>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </article>
          )
        })}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Add from preset</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {PRESETS.map((preset) => {
            const added = addedPresetIds.has(preset.id)
            return (
              <button
                key={preset.id}
                type="button"
                disabled={added || busyId !== null}
                onClick={() => void handleAdd(preset)}
                className="flex min-h-11 flex-col items-start gap-1 rounded-2xl border border-[#262B39] bg-[#161922] p-4 text-left hover:border-[#8B7CFF] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="font-semibold">{preset.name}</span>
                <span className="text-xs text-[#9AA1B2]">
                  {added
                    ? 'Added'
                    : busyId === preset.id
                      ? 'Adding…'
                      : `${preset.meters.length} meter${preset.meters.length === 1 ? '' : 's'} · ${preset.tasks.length} tasks`}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      {error && (
        <p role="alert" className="text-sm text-[#FF8A8A]">
          {error}
        </p>
      )}
    </div>
  )
}