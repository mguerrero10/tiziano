import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { EyeIcon } from '../components/EyeIcon'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

type Mode = 'login' | 'register'

const REGISTER_ENABLED = false

export function LoginPage() {
  const { session, loading, me } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (loading || (session && !me)) {
    return (
      <div className="aplicacion-carga" role="status" aria-label="Carga en curso">
        <span className="aplicacion-carga-simbolo" aria-hidden="true" />
      </div>
    )
  }

  if (session && me) {
    if (!me.platformAdmin && !me.hasSalon) {
      return (
        <main className="acceso">
          <Brand />
          <p className="error">
            Tu cuenta no tiene acceso a la plataforma ni a ninguna peluquería.
            Contactá a Turno Salón.
          </p>
          <button type="button" className="primary" onClick={() => void supabase.auth.signOut()}>
            Cerrar sesión
          </button>
        </main>
      )
    }

    const target = me.platformAdmin ? '/plataforma' : '/'
    const from = (location.state as { from?: string } | null)?.from
    const redirectTo = from && (me.platformAdmin || from.startsWith('/plataforma')) ? from : target
    return <Navigate to={redirectTo} replace />
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setMessage(null)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setSubmitting(true)

    try {
      if (mode === 'register') {
        const { error: signUpError } = await supabase.auth.signUp({ email, password })
        if (signUpError) {
          throw signUpError
        }
        setMessage('Cuenta creada. Si Supabase pide confirmación, revisá tu email.')
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (signInError) {
          throw signInError
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo autenticar')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="acceso">
      <Brand />

      {REGISTER_ENABLED ? (
        <div className="segmentado" role="tablist" aria-label="Acceso">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'esta-activo' : ''}
            onClick={() => switchMode('login')}
          >
            Ingresar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'esta-activo' : ''}
            onClick={() => switchMode('register')}
          >
            Crear cuenta
          </button>
        </div>
      ) : null}

      <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            placeholder="nombre@ejemplo.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label>
          Contraseña
          <span className="campo">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
            <button
              type="button"
              className="mostrar"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              <EyeIcon off={showPassword} />
            </button>
          </span>
        </label>

        {error ? <p className="error">{error}</p> : null}
        {message ? <p className="correcto">{message}</p> : null}

        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? 'Un momento…' : mode === 'login' ? 'Ingresar' : 'Crear cuenta'}
        </button>
      </form>
    </main>
  )
}
