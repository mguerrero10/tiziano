import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

export function PlatformRoute({ children }: { children: ReactNode }) {
  const { session, loading, me } = useAuth()

  if (loading) {
    return (
      <div className="aplicacion-carga" role="status" aria-label="Carga en curso">
        <span className="aplicacion-carga-simbolo" aria-hidden="true" />
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (session && !me) {
    return (
      <div className="aplicacion-carga" role="status" aria-label="Carga en curso">
        <span className="aplicacion-carga-simbolo" aria-hidden="true" />
      </div>
    )
  }

  if (!me?.platformAdmin) {
    return <Navigate to="/" replace />
  }

  return children
}
