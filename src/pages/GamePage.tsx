import { Link, NavLink, useParams } from 'react-router'
import { SHORT_NAMES, useGames } from '../lib/useGames'

const SECTIONS = ['Stamina', 'Daily', 'Weekly', 'Endgame', 'Events', 'Goals']

// Step 1 placeholder: game tabs + the section layout.
// Step 3 fills in the real checklist, step 4 the live stamina and countdowns.
export default function GamePage() {
  const { presetId } = useParams()
  const { games, loading, error } = useGames()
  const game = games.find((g) => g.preset_id === presetId)

  return (
    <div className="flex flex-col gap-5">
      {games.length > 1 && (
        <div role="group" aria-label="Game" className="flex w-full gap-1 rounded-xl border border-line bg-surface p-1 md:w-fit">
          {games.map((g) => (
            <NavLink
              key={g.id}
              to={`/game/${g.preset_id}`}
              className={({ isActive }) =>
                `flex min-h-10 flex-1 items-center justify-center rounded-lg px-4 text-sm font-semibold ${
                  isActive ? 'bg-accent text-on-accent' : 'text-muted hover:text-ink'
                }`
              }
            >
              {SHORT_NAMES[g.preset_id ?? ''] ?? g.name}
            </NavLink>
          ))}
        </div>
      )}

      {loading && <p className="text-muted">Loading…</p>}
      {error && <p className="text-urgent">{error}</p>}

      {!loading && !game && (
        <p className="text-muted">
          This game isn't in your list. <Link to="/games" className="text-accent underline">Manage games</Link>
        </p>
      )}

      {game && (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h1 className="font-display text-2xl font-bold">{game.name}</h1>
          <p className="mt-1 text-sm text-muted">
            Daily reset {game.daily_reset_time?.slice(0, 5)} server time
          </p>

          <div className="mt-5 flex flex-wrap gap-6">
            <div className="flex min-w-0 flex-[999_1_300px] flex-col gap-4">
              {SECTIONS.slice(1, 3).map((s) => (
                <Placeholder key={s} title={s} />
              ))}
            </div>
            <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-4">
              {[SECTIONS[0], ...SECTIONS.slice(3)].map((s) => (
                <Placeholder key={s} title={s} />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="rounded-xl bg-raised p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted">Coming in the next steps.</p>
    </div>
  )
}