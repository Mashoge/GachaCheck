import type { ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { supabase } from '../lib/supabase'
import { Button, EventsIcon, GamesIcon, RemindersIcon, TodayIcon } from './ui'

type NavItem = { to: string; label: string; icon: ReactNode }

const NAV: NavItem[] = [
  { to: '/', label: 'Today', icon: <TodayIcon size={22} /> },
  { to: '/events', label: 'Events', icon: <EventsIcon size={22} /> },
  { to: '/games', label: 'Games', icon: <GamesIcon size={22} /> },
  { to: '/reminders', label: 'Reminders', icon: <RemindersIcon size={22} /> },
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
                  className={`rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${
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
            <Button onClick={() => void supabase.auth.signOut()}>Sign out</Button>
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
            className={`flex min-h-13 flex-col items-center justify-center gap-1 rounded-lg text-xs ${
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
