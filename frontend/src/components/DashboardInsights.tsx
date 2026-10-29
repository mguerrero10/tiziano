import { formatDashboardPeriod } from '../lib/dashboardDates'

export type DashboardInsightsData = {
  topCustomers: Array<{ name: string; visits: number; lastVisitAt: string }>
  appointmentsByDay: Array<{ day: string; count: number }>
  topServices: Array<{ name: string; count: number }>
  busyHours: Array<{ hour: number; count: number }>
  topStaff: Array<{ name: string; count: number }>
  topProducts: Array<{ name: string; count: number }>
}

type Props = {
  insights: DashboardInsightsData
  timezone: string
  showProducts: boolean
}

export function DashboardInsights({ insights, timezone, showProducts }: Props) {
  const endDay = insights.appointmentsByDay.at(-1)?.day
  const period14 = formatDashboardPeriod(13, timezone, endDay)
  const period30 = formatDashboardPeriod(30, timezone, endDay)
  const period90 = formatDashboardPeriod(90, timezone, endDay)
  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  const visitFormatter = new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  })

  return (
    <section className="indicadores-grid" aria-label="Indicadores del salón">
      <article className="tarjeta-panel indicador-tarjeta indicador-tarjeta-rosa">
        <div className="tarjeta-panel-header">
          <div>
            <h2>Clientes que más asisten</h2>
            <p>{period90} · Turnos confirmados</p>
          </div>
        </div>
        {insights.topCustomers.length ? (
          <ul className="indicador-barras">
            {insights.topCustomers.map((customer, index) => (
              <li key={`${customer.name}-${customer.lastVisitAt}-${index}`}>
                <div className="indicador-barras-datos">
                  <strong>{customer.name}</strong>
                  <span>{customer.visits} {customer.visits === 1 ? 'visita' : 'visitas'}</span>
                </div>
                <div className="indicador-barras-pista" aria-hidden="true">
                  <span style={{ width: `${barWidth(customer.visits, insights.topCustomers.map((item) => item.visits))}%` }} />
                </div>
                <small>Última vez {visitFormatter.format(new Date(customer.lastVisitAt))}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="indicador-vacio">Sin visitas confirmadas en este período.</p>
        )}
      </article>

      <article className="tarjeta-panel indicador-tarjeta indicador-tarjeta-dorado">
        <div className="tarjeta-panel-header">
          <div>
            <h2>Turnos por día</h2>
            <p>{period14} · Sin cancelados</p>
          </div>
        </div>
        <ColumnChart
          points={insights.appointmentsByDay.map((point) => {
            const label = formatDayLabel(point.day)
            return {
              key: point.day,
              value: point.count,
              label: label.weekday,
              caption: label.day,
              current: point.day === todayKey,
            }
          })}
          empty="Sin turnos en este período."
        />
      </article>

      <article className="tarjeta-panel indicador-tarjeta indicador-tarjeta-verde-salvia">
        <div className="tarjeta-panel-header">
          <div>
            <h2>Servicios más pedidos</h2>
            <p>{period30}</p>
          </div>
        </div>
        <RankBars
          items={insights.topServices.map((service) => ({
            label: service.name,
            value: service.count,
            valueLabel: service.count === 1 ? '1 turno' : `${service.count} turnos`,
          }))}
          empty="Sin turnos en este período."
        />
      </article>

      <article className="tarjeta-panel indicador-tarjeta indicador-tarjeta-rosa">
        <div className="tarjeta-panel-header">
          <div>
            <h2>Horarios con más demanda</h2>
            <p>{period30} · Hora del salón</p>
          </div>
        </div>
        <ColumnChart
          points={insights.busyHours.map((point) => ({
            key: String(point.hour),
            value: point.count,
            label: `${String(point.hour).padStart(2, '0')}h`,
          }))}
          empty="Sin turnos para ver los horarios pico."
        />
      </article>

      <article className="tarjeta-panel indicador-tarjeta indicador-tarjeta-dorado">
        <div className="tarjeta-panel-header">
          <div>
            <h2>Profesionales con más turnos</h2>
            <p>{period30}</p>
          </div>
        </div>
        <RankBars
          items={insights.topStaff.map((staff) => ({
            label: staff.name,
            value: staff.count,
            valueLabel: staff.count === 1 ? '1 turno' : `${staff.count} turnos`,
          }))}
          empty="Sin turnos asignados en este período."
        />
      </article>

      {showProducts ? (
        <article className="tarjeta-panel indicador-tarjeta indicador-tarjeta-verde-salvia">
          <div className="tarjeta-panel-header">
            <div>
              <h2>Productos más vendidos</h2>
              <p>{period30} · Pagados</p>
            </div>
          </div>
          <RankBars
            items={insights.topProducts.map((product) => ({
              label: product.name,
              value: product.count,
              valueLabel: product.count === 1 ? '1 unidad' : `${product.count} unidades`,
            }))}
            empty="Sin ventas pagadas en este período."
          />
        </article>
      ) : null}
    </section>
  )
}

function RankBars({
  items,
  empty,
}: {
  items: Array<{ label: string; value: number; valueLabel: string }>
  empty: string
}) {
  if (!items.length) return <p className="indicador-vacio">{empty}</p>
  const values = items.map((item) => item.value)

  return (
    <ul className="indicador-barras">
      {items.map((item, index) => (
        <li key={`${item.label}-${index}`}>
          <div className="indicador-barras-datos">
            <strong>{item.label}</strong>
            <span>{item.valueLabel}</span>
          </div>
          <div className="indicador-barras-pista" aria-hidden="true">
            <span style={{ width: `${barWidth(item.value, values)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function ColumnChart({
  points,
  empty,
}: {
  points: Array<{ key: string; value: number; label: string; caption?: string; current?: boolean }>
  empty: string
}) {
  const total = points.reduce((sum, point) => sum + point.value, 0)
  if (!points.length || total === 0) return <p className="indicador-vacio">{empty}</p>
  const max = Math.max(...points.map((point) => point.value), 1)

  return (
    <div className="indicador-columnas" role="list">
      {points.map((point) => (
        <div
          className={point.current ? 'indicador-columnas-elemento esta-actual' : 'indicador-columnas-elemento'}
          key={point.key}
          role="listitem"
          title={`${point.caption ? `${point.label} ${point.caption}` : point.label}: ${point.value}`}
        >
          <span className="indicador-columnas-valor">{point.value > 0 ? point.value : ''}</span>
          <div className="indicador-columnas-grafico">
            <span
              className="indicador-columnas-barra"
              style={{ height: point.value > 0 ? `${Math.max((point.value / max) * 100, 8)}%` : '0%' }}
            />
          </div>
          <span className="indicador-columnas-rotulo">
            {point.label}
            {point.caption ? <small>{point.caption}</small> : null}
          </span>
        </div>
      ))}
    </div>
  )
}

function barWidth(value: number, values: number[]) {
  const max = Math.max(...values, 1)
  return Math.max((value / max) * 100, 6)
}

function formatDayLabel(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const weekday = new Intl.DateTimeFormat('es-AR', { weekday: 'short' }).format(date).replace('.', '')
  return { weekday, day: String(day) }
}
