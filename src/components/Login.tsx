import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Card, Field, Input, Notice, PageTitle } from './ui'

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
      <Card
        as="form"
        padding="none"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          void signIn()
        }}
        className="w-full max-w-sm space-y-4 p-6"
      >
        <PageTitle size="md">GachaCheck</PageTitle>

        <Field id="email" label="Email">
          <Input size="lg" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>

        <Field id="password" label="Password">
          <Input size="lg" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>

        {error && <Notice tone="error">{error}</Notice>}

        <Button type="submit" variant="primary" size="lg" full disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </Card>
    </main>
  )
}
