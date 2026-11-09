import { useState } from 'react'
import { supabase } from '../lib/supabase'
import Wordmark from '../components/Wordmark'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className="min-h-full grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <Wordmark className="mb-10" />
        {sent ? (
          <div className="card p-6">
            <h1 className="text-lg font-semibold mb-2">Revisa tu correo</h1>
            <p className="text-ink-2">
              Te enviamos un enlace a <span className="font-medium text-ink">{email}</span>. Ábrelo desde este
              mismo dispositivo para entrar.
            </p>
            <button className="btn btn-ghost btn-sm mt-4 -ml-2" onClick={() => setSent(false)}>
              Usar otro correo
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="card p-6">
            <h1 className="text-lg font-semibold mb-1">Entrar</h1>
            <p className="text-ink-2 mb-5">Sin contraseña: te enviamos un enlace de acceso a tu correo.</p>
            <label className="block text-ink-2 mb-1" htmlFor="email">Correo</label>
            <input
              id="email" type="email" required autoFocus className="input"
              value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com"
            />
            {error && <p className="text-bad mt-3">{error}</p>}
            <button className="btn btn-primary w-full mt-5" disabled={busy}>
              {busy ? 'Enviando…' : 'Enviar enlace'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
