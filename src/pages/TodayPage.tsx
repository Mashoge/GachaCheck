import { Link } from 'react-router'
import { useGames } from '../lib/useGames'

// Step 1 placeholder: proves the routing works.
// Step 2 replaces this with Needs attention + the real game cards.
export default function TodayPage() {
  const { games, loading, error } = useGames()

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-bold">Today</h1>

      {loading && <p className="text-muted">Loading your games…</p>}
      {error && <p className="text-urgent">{error}</p>}

      {!loading && games.length === 0 && (
        <p className="text-muted">
          No games yet. <Link to="/games" className="text-accent underline">Add one</Link>.
        </p>
      )}

      <div className="flex flex-wrap gap-4">
        {games.map((game) => (
          <Link
            key={game.id}
            to={`/game/${game.preset_id}`}
            className="flex min-w-0 flex-[1_1_280px] items-center justify-between rounded-2xl border border-line bg-surface p-4 hover:border-muted"
          >
            <span className="font-semibold">{game.name}</span>
            <span className="text-sm text-muted">Open ›</span>
          </Link>
        ))}
      </div>
    </div>
  )
}