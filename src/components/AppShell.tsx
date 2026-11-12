import type { ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { supabase } from '../lib/supabase'

type NavItem = { to: string; label: string; icon: ReactNode }

const icon = (d: ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
)

const NAV: NavItem[] = [
  { to: '/', label: 'Today', icon: icon(<><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>) },
  { to: '/events', label: 'Events', icon: icon(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>) },
  { to: '/games', label: 'Games', icon: icon(<><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>) },
  { to: '/reminders', label: 'Reminders', icon: icon(<><path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 20a2 2 0 0 0 4 0" /></>) },
]

export default function AppShell({ email }: { email: string }) {
  const { pathname } = useLocation()

  // Game pages belong to Today
  const isActive = (to: string) =>
    to === '/' ? pathname === '/' || pathname.startsWith('/game/') : pathname.startsWith(to)

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-7">
            <span className="font-display text-xl font-bold">GachaCheck</span>
            <nav aria-label="Main" className="hidden gap-1 md:flex">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  aria-current={isActive(item.to) ? 'page' : undefined}
                  className={`rounded-lg px-3.5 py-2.5 text-sm font-medium ${
                    isActive(item.to) ? 'bg-active text-accent' : 'text-muted hover:text-ink'
                  }`}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">{email}</span>
            <button
              type="button"
              onClick={() => void supabase.auth.signOut()}
              className="min-h-11 rounded-lg border border-line px-3 text-muted hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Room for the bottom bar, plus the iPhone home line */}
      <main className="mx-auto max-w-6xl px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-6 md:px-5 md:pb-12">
        <Outlet />
      </main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface px-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-1.5 md:hidden">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            aria-current={isActive(item.to) ? 'page' : undefined}
            className={`flex min-h-13 flex-col items-center justify-center gap-1 text-[11px] ${
              isActive(item.to) ? 'font-semibold text-accent' : 'font-medium text-muted'
            }`}
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
