import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

export default function App() {
  const [status, setStatus] = useState('Checking connection…')

  useEffect(() => {
    supabase.auth.getSession().then(({ error }) => {
      setStatus(error ? `Error: ${error.message}` : 'Connected to Supabase ✅')
    })
  }, [])

  return (
    <main className="grid min-h-screen place-items-center bg-[#0D0F14] text-[#ECEEF3]">
      <div className="text-center">
        <h1 className="text-4xl font-bold">GachaCheck</h1>
        <p className="mt-2 text-[#9AA1B2]">{status}</p>
      </div>
    </main>
  )
}