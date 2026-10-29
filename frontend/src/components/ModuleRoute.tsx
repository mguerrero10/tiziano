import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { hasBookingModules, hasModule } from '../lib/modules'

type ModuleRouteProps = {
  children: ReactNode
  module?: string
  anyOf?: readonly string[]
}

export function ModuleRoute({ children, module, anyOf }: ModuleRouteProps) {
  const { me, loading } = useAuth()
  const enabled = me?.enabledModules ?? []

  if (loading || !me) {
    return (
      <div className="aplicacion-carga" role="status" aria-label="Carga en curso">
        <span className="aplicacion-carga-simbolo" aria-hidden="true" />
      </div>
    )
  }

  const allowed = module
    ? hasModule(enabled, module)
    : anyOf
      ? anyOf.some((key) => hasModule(enabled, key))
      : hasBookingModules(enabled)

  if (!allowed) {
    return <Navigate to="/" replace />
  }

  return children
}
