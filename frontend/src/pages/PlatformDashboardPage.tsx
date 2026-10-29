import { useEffect, useState } from 'react'
import { CalendarDays, House, UsersRound } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { apiGet } from '../lib/api'

type PlatformDashboard = {
  summary: {
    totalSalons: number
    activeSalons: number
    totalCustomers: number
    appointmentsThisMonth: number
    enabledModules: number
  }
  modules: Array<{
    key: string
    name: string
    salonCount: number
  }>
}

export function PlatformDashboardPage() {
  const { session } = useAuth()
  const [data, setData] = useState<PlatformDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return
    apiGet<PlatformDashboard>('/api/platform/dashboard', session.access_token)
      .then(setData)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'No se pudo cargar la plataforma.')
      })
  }, [session])

  return (
    <div className="panel">
      <section className="header-panel">
        <div>
          <span className="antetitulo">Turno Salón</span>
          <h1>Dashboard de plataforma</h1>
        </div>
      </section>

      {error ? <p className="error">{error}</p> : null}

      {data ? (
        <>
          <section className="estadisticas-grid plataforma-estadisticas">
            <article className="estadistica-tarjeta estadistica-tarjeta-azul">
              <span>Clientes activos</span>
              <strong>{data.summary.activeSalons}</strong>
              <small>de {data.summary.totalSalons} peluquerías</small>
              <span className="estadistica-tarjeta-icono"><House size={20} strokeWidth={1.8} /></span>
            </article>
            <article className="estadistica-tarjeta estadistica-tarjeta-naranja">
              <span>Turnos este mes</span>
              <strong>{data.summary.appointmentsThisMonth}</strong>
              <small>en toda la plataforma</small>
              <span className="estadistica-tarjeta-icono"><CalendarDays size={20} strokeWidth={1.8} /></span>
            </article>
            <article className="estadistica-tarjeta estadistica-tarjeta-verde">
              <span>Clientes finales</span>
              <strong>{data.summary.totalCustomers}</strong>
              <small>personas atendidas</small>
              <span className="estadistica-tarjeta-icono"><UsersRound size={20} strokeWidth={1.8} /></span>
            </article>
          </section>

          <section className="tarjeta-panel">
            <div className="tarjeta-panel-header">
              <div>
                <h2>Módulos contratados</h2>
                <p>{data.summary.enabledModules} habilitaciones activas</p>
              </div>
            </div>
            <div className="modulo-uso">
              {data.modules.map((module) => (
                <article key={module.key}>
                  <span>{module.name}</span>
                  <strong>{module.salonCount}</strong>
                  <small>salones</small>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
