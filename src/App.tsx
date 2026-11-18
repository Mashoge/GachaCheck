import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Navigate, Route, Routes } from 'react-router'
import { supabase } from './lib/supabase'
import Login from './components/Login'
import AppShell from './components/AppShell'
import BulkUndoProvider from './components/bulkUndo/BulkUndoProvider'
import { ConfirmProvider, Loading } from './components/ui'
import { usePwaInstall } from './lib/usePwaInstall'
import { prefetchAppData } from './lib/appData'

// Each page's code is a separate download, so the app starts faster on a phone. Once signed in, the
// rest (code and data) are fetched in the background while the browser is idle (THM-10), so opening a
// page for the first time doesn't wait either. Data saver skips that and loads each page when opened.
const pages = {
  today: () => import('./pages/TodayPage'),
  game: () => import('./pages/GamePage'),
  events: () => import('./pages/EventsPage'),
  reminders: () => import('./pages/RemindersPage'),
  games: () => import('./components/GamesScreen'),
}
const TodayPage = lazy(pages.today)
const GamePage = lazy(pages.game)
const EventsPage = lazy(pages.events)
const RemindersPage = lazy(pages.reminders)
const GamesScreen = lazy(pages.games)

function usePrefetchPages(enabled: boolean) {
  useEffect(() => {
    if (!enabled || document.documentElement.hasAttribute('data-saver')) return
    const fetchAll = () => {
      for (const load of Object.values(pages)) void load().catch(() => {}) // a failed fetch retries when opened
      prefetchAppData() // and their data, so the first visit to each page is instant too
    }
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(fetchAll, { timeout: 4000 })
      return () => window.cancelIdleCallback(id)
    }
    const timer = setTimeout(fetchAll, 1500)
    return () => clearTimeout(timer)
  }, [enabled])
}

const page = (element: ReactNode) => <Suspense fallback={<Loading />}>{element}</Suspense>

export default function App() {
  // Listen above the auth gate so Chromium's one-shot install event cannot be missed.
  const pwaInstall = usePwaInstall()
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  usePrefetchPages(!!session)

  if (!ready) return null
  if (!session) return <Login />

  return (
    <ConfirmProvider>
      <BulkUndoProvider>
        <Routes>
          <Route element={<AppShell email={session.user.email ?? ''} pwaInstall={pwaInstall} />}>
            <Route index element={page(<TodayPage />)} />
            <Route path="game/:presetId" element={page(<GamePage />)} />
            <Route
              path="games"
              element={page(<GamesScreen />)}
            />
            <Route path="events" element={page(<EventsPage />)} />
            <Route path="reminders" element={page(<RemindersPage />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BulkUndoProvider>
    </ConfirmProvider>
  )
}
