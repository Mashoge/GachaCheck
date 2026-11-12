import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Navigate, Route, Routes } from 'react-router'
import { supabase } from './lib/supabase'
import Login from './components/Login'
import AppShell from './components/AppShell'
import GamesScreen from './components/GamesScreen'
import TodayPage from './pages/TodayPage'
import GamePage from './pages/GamePage'
import EventsPage from './pages/EventsPage'
import RemindersPage from './pages/RemindersPage'

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
    <Routes>
      <Route element={<AppShell email={session.user.email ?? ''} />}>
        <Route index element={<TodayPage />} />
        <Route path="game/:presetId" element={<GamePage />} />
        <Route
          path="games"
          element={
            <div className="mx-auto max-w-3xl">
              <GamesScreen />
            </div>
          }
        />
        <Route path="events" element={<EventsPage />} />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
