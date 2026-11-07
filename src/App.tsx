import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Login from './components/login'

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
    <main className="grid min-h-screen place-items-center bg-[#0D0F14] text-[#ECEEF3]">
      <div className="space-y-3 text-center">
        <h1 className="text-4xl font-bold">GachaCheck</h1>
        <p className="text-[#9AA1B2]">Signed in as {session.user.email}</p>
        <button onClick={() => supabase.auth.signOut()}
          className="h-10 rounded-xl border border-[#3A4052] bg-[#262B39] px-4 text-sm">
          Sign out
        </button>
      </div>
    </main>
  )
}