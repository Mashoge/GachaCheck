import { useState } from 'react'
import { Link, NavLink, useParams } from 'react-router'
import { messageOf } from '../lib/errors'
import { setCycleDates } from '../lib/games'
import { useTodayData, type Task } from '../lib/today'
import GameDashboard from './game/GameDashboard'
import { SHORT_NAMES } from '../lib/useGames'
import { useNow } from '../lib/useNow'
import { initialGameView, saveGameView, type GameView } from '../lib/gameView'
import { GameIcon } from '../components/GameIcon'
import { Loading, Notice, ToggleGroup } from '../components/ui'
import { useGameIcons } from '../lib/useGameIcons'

export default function GamePage() {
  const { presetId } = useParams()
  const { data, error, loading, refresh, addCompletion, removeCompletions, setMeterValue, setSkipped } = useTodayData()
  const now = useNow()
  // Phone opens on "What's left", PC on "Everything"; after that, the last choice on this device
  const [view, setView] = useState<GameView>(() => initialGameView())
  const quick = view === 'left'
  const chooseView = (next: GameView) => {
    setView(next)
    saveGameView(next)
  }
  const [saveError, setSaveError] = useState<string | null>(null)

  // `cycleOver` = the old end date has passed, so this is a new cycle. Without a start date it counts from
  // where the old one ended, so a clear from the old cycle isn't counted again.
  const saveEndDate = async (task: Task, endsAt: string, startDay: string | null, cycleOver: boolean) => {
    setSaveError(null)
    const previousEnd = cycleOver && task.cycle_ends_at ? task.cycle_ends_at.slice(0, 10) : null
    try {
      await setCycleDates(task.id, endsAt, startDay ?? previousEnd)
    } catch (err) {
      setSaveError(messageOf(err))
    }
    await refresh()
  }

  const games = data?.games ?? []
  const game = games.find((g) => g.preset_id === presetId)
  const icons = useGameIcons(games)

  return (
    <div className="flex flex-col gap-5">
      {/* THM-9: the game switcher and the view toggle as slanted chips, like the Events filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {games.length > 1 && (
          <nav aria-label="Game" className="flex flex-wrap gap-2 pl-1">
            {games.map((g) => (
              <NavLink key={g.id} to={`/game/${g.preset_id}`} className="gc-chip inline-flex items-center">
                <span>
                  <GameIcon presetId={g.preset_id} url={icons[g.id]} size={18} />
                  {SHORT_NAMES[g.preset_id ?? ''] ?? g.name}
                </span>
              </NavLink>
            ))}
          </nav>
        )}
        <ToggleGroup
          label="Show tasks"
          shape="slant"
          className="ml-auto"
          value={view}
          onChange={(value) => chooseView(value === 'left' ? 'left' : 'all')}
          options={[{ id: 'left', label: "What's left" }, { id: 'all', label: 'Everything' }]}
        />
      </div>

      {loading && <Loading />}
      {(error || saveError) && <Notice tone="error" size="md">{error ?? saveError}</Notice>}
      {data && !game && (
        <p className="text-muted">
          This game isn't in your list. <Link to="/games" className="inline-flex min-h-11 items-center text-accent underline">Manage games</Link>
        </p>
      )}

      {data && game && (
        <GameDashboard
          game={game}
          data={data}
          now={now}
          quick={quick}
          onTick={(task, periodStart) => addCompletion(task.id, periodStart)}
          onRemove={(task, ids) => removeCompletions(task.id, ids)}
          onSetMeter={(meterId, value) => void setMeterValue(game, meterId, value)}
          onSetEndDate={(task, endsAt, startDay, cycleOver) => void saveEndDate(task, endsAt, startDay, cycleOver)}
          onSetSkipped={(skip) => void setSkipped(game, skip)}
        />
      )}
    </div>
  )
}
