import { useState } from 'react'
import { supabase } from '../lib/supabase'

const inputClass = 'h-11 w-full rounded-xl border border-line bg-page px-3 text-ink outline-none focus:border-accent'

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
    <main className="grid min-h-screen place-items-center px-5">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void signIn()
        }}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6"
      >
        <h1 className="font-display text-2xl font-bold">GachaCheck</h1>

        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm text-muted">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm text-muted">Password</label>
          <input id="password" type="password" autoComplete="current-password" required value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass} />
        </div>

        {error && <p role="alert" className="text-sm text-urgent">{error}</p>}

        <button type="submit" disabled={loading}
          className="h-11 w-full rounded-xl bg-accent font-semibold text-on-accent disabled:opacity-60">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
