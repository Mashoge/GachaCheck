import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Navigate, Route, Routes } from 'react-router'
import { supabase } from './lib/supabase'
import Login from './components/Login'
import AppShell from './components/AppShell'
import { ConfirmProvider, Loading } from './components/ui'

// Each page loads when it's first opened, so the app starts faster on a phone
const TodayPage = lazy(() => import('./pages/TodayPage'))
const GamePage = lazy(() => import('./pages/GamePage'))
const EventsPage = lazy(() => import('./pages/EventsPage'))
const RemindersPage = lazy(() => import('./pages/RemindersPage'))
const GamesScreen = lazy(() => import('./components/GamesScreen'))

const page = (element: ReactNode) => <Suspense fallback={<Loading />}>{element}</Suspense>

export default function App() {
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

  if (!ready) return null
  if (!session) return <Login />

  return (
    <ConfirmProvider>
      <Routes>
        <Route element={<AppShell email={session.user.email ?? ''} />}>
          <Route index element={page(<TodayPage />)} />
          <Route path="game/:presetId" element={page(<GamePage />)} />
          <Route
            path="games"
            element={page(
              <div className="mx-auto max-w-3xl">
                <GamesScreen />
              </div>,
            )}
          />
          <Route path="events" element={page(<EventsPage />)} />
          <Route path="reminders" element={page(<RemindersPage />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ConfirmProvider>
  )
}
