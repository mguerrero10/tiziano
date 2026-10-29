import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppointmentBadgeLegend, AppointmentBadges } from '../components/AppointmentBadges'
import { DashboardInsights, type DashboardInsightsData } from '../components/DashboardInsights'
import { apiErrorMessage, apiGet } from '../lib/api'
import { hasBookingModules, hasModule } from '../lib/modules'

type DashboardData = {
  salon: { name: string; slug: string; timezone: string; role: string }
  stats: { today: number; upcoming: number; customers: number; visits?: number }
  insights?: DashboardInsightsData
  modules: Array<{ key: string; name: string }>
  appointments: Array<{
    id: string
    startsAt: string
    customerName: string
    serviceName: string
    staffName: string
    status: string
    paymentMethod?: string | null
    paymentStatus?: string | null
  }>
}

export function DashboardPage() {
  const { session, me } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const showBooking = hasBookingModules(me?.enabledModules)
  const showProducts = hasModule(me?.enabledModules, 'products')

  useEffect(() => {
    if (!session) return
    apiGet<DashboardData>('/api/dashboard', session.access_token)
      .then(setData)
      .catch((reason: unknown) => {
        setError(apiErrorMessage(reason))
      })
  }, [session])

  if (!session) return null

  const dateFormatter = new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: data?.salon.timezone,
  })

  return (
    <div className="panel">
      <section className="header-panel">
        <div>
          <span className="antetitulo">Panel general</span>
          <h1>{data?.salon.name ?? me?.salon?.name}</h1>
          {data?.modules.length ? (
            <div className="modulo-etiquetas">
              {data.modules.map((module) => (
                <span className="modulo-etiqueta" key={module.key}>{module.name}</span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="acciones-header-panel">
          {data && showBooking ? (
            <Link className="secundario" to={`/s/${data.salon.slug}`}>
              Web reservas
            </Link>
          ) : null}
          {data && showProducts && me?.salon?.storeEnabled !== false ? (
            <Link className="secundario" to={`/s/${data.salon.slug}/tienda`}>
              Tienda pública
            </Link>
          ) : null}
        </div>
      </section>

      {error ? (
        <section className="tarjeta-panel vacio-situacion">
          <p className="error">{error}</p>
        </section>
      ) : null}

      {data && showProducts && !showBooking ? (
        <section className="tarjeta-panel">
          <div className="tarjeta-panel-header">
            <div>
              <h2>Productos</h2>
              <p>Tu salón tiene habilitada la venta de productos.</p>
            </div>
            <div className="tarjeta-panel-acciones">
              <Link className="texto-boton" to="/productos">Gestionar catálogo</Link>
              {me?.salon?.storeEnabled !== false ? (
                <Link className="texto-boton" to={`/s/${data.salon.slug}/tienda`}>
                  Ver tienda
                </Link>
              ) : (
                <Link className="texto-boton" to="/ajustes">Activar tienda</Link>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {data && showBooking ? (
        <>
          <section className="tarjeta-panel">
            <div className="tarjeta-panel-header">
              <div>
                <h2>Próximos turnos</h2>
                <AppointmentBadgeLegend />
              </div>
            </div>

            {data.appointments.length ? (
              <div className="turno-lista turno-lista-desplazamiento personalizado-desplazamiento">
                {data.appointments.map((appointment) => (
                  <article className="turno-fila" key={appointment.id}>
                    <time>{dateFormatter.format(new Date(appointment.startsAt))}</time>
                    <div>
                      <strong>{appointment.customerName}</strong>
                      <span>{appointment.serviceName}</span>
                    </div>
                    <span className="turno-profesionales">{appointment.staffName}</span>
                    <AppointmentBadges
                      status={appointment.status}
                      paymentMethod={appointment.paymentMethod}
                      paymentStatus={appointment.paymentStatus}
                    />
                  </article>
                ))}
              </div>
            ) : (
              <div className="vacio-situacion">
                <h2>Sin próximos turnos</h2>
              </div>
            )}
          </section>

          {data.insights ? (
            <DashboardInsights
              insights={data.insights}
              timezone={data.salon.timezone}
              showProducts={showProducts}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
