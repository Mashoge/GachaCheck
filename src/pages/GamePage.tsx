import { useState } from 'react'
import { Link, NavLink, useParams } from 'react-router'
import { messageOf } from '../lib/errors'
import { setCycleDates } from '../lib/games'
import { useTodayData, type Task } from '../lib/today'
import GameDashboard from './game/GameDashboard'
import { SHORT_NAMES } from '../lib/useGames'
import { useNow } from '../lib/useNow'
import { buttonClass, ToggleGroup } from '../components/ui'

// Phone opens on "What's left", PC on "Everything"
const startsQuick = () => typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches

export default function GamePage() {
  const { presetId } = useParams()
  const { data, error, loading, refresh, addCompletion, removeCompletions, setMeterValue } = useTodayData()
  const now = useNow()
  const [quick, setQuick] = useState(startsQuick)
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

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {games.length > 1 && (
          <div role="group" aria-label="Game" className="flex w-full gap-1 rounded-xl border border-line bg-surface p-1 md:w-fit">
            {games.map((g) => (
              <NavLink
                key={g.id}
                to={`/game/${g.preset_id}`}
                className={({ isActive }) => `${buttonClass({ variant: isActive ? 'primary' : 'quiet', size: 'lg' })} flex-1`}
                style={{ borderRadius: '0.5rem' }}
              >
                {SHORT_NAMES[g.preset_id ?? ''] ?? g.name}
              </NavLink>
            ))}
          </div>
        )}
        <div className="ml-auto rounded-full border border-line bg-surface p-1">
          <ToggleGroup
            label="Show tasks"
            value={quick ? 'left' : 'all'}
            onChange={(value) => setQuick(value === 'left')}
            options={[{ id: 'left', label: "What's left" }, { id: 'all', label: 'Everything' }]}
          />
        </div>
      </div>

      {loading && <p className="text-muted">Loading…</p>}
      {(error || saveError) && <p className="text-urgent">{error ?? saveError}</p>}
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
        />
      )}
    </div>
  )
}
