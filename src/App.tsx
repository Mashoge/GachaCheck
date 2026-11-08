import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Login from './components/Login'
import GamesScreen from './components/GamesScreen'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return <main className="min-h-screen bg-[#0D0F14]" />
  if (!session) return <Login />

    return (
    <div className="min-h-screen bg-[#0D0F14] text-[#ECEEF3]">
      <header className="border-b border-[#232838] bg-[#11141B]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-3">
          <span className="text-lg font-bold">GachaCheck</span>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-[#9AA1B2] sm:inline">{session.user.email}</span>
            <button
              type="button"
              onClick={() => void supabase.auth.signOut()}
              className="h-9 rounded-lg border border-[#3A4052] bg-[#262B39] px-3"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-6">
        <GamesScreen />
      </main>
    </div>
  )
}