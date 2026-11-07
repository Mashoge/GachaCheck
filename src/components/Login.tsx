import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function signIn() {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#0D0F14] px-5 text-[#ECEEF3]">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void signIn()
        }}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-[#262B39] bg-[#161922] p-6"
      >
        <h1 className="text-2xl font-bold">GachaCheck</h1>

        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm text-[#C9CDD8]">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 w-full rounded-xl border border-[#2E3445] bg-[#0D0F14] px-3 outline-none focus:border-[#8B7CFF]" />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm text-[#C9CDD8]">Password</label>
          <input id="password" type="password" autoComplete="current-password" required value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 w-full rounded-xl border border-[#2E3445] bg-[#0D0F14] px-3 outline-none focus:border-[#8B7CFF]" />
        </div>

        {error && <p role="alert" className="text-sm text-[#FF8A8A]">{error}</p>}

        <button type="submit" disabled={loading}
          className="h-11 w-full rounded-xl bg-[#8B7CFF] font-semibold text-[#0D0F14] disabled:opacity-60">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}