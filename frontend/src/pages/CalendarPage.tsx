import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { AppointmentBadgeLegend, AppointmentBadges } from '../components/AppointmentBadges'
import { apiGet, apiPatch } from '../lib/api'

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

type Appointment = {
  id: string
  startsAt: string
  endsAt: string
  status: string
  customerName: string
  customerPhone: string
  serviceName: string
  staffName: string
  detalle?: string | null
  notes?: string | null
  paymentMethod?: string | null
  paymentStatus?: string | null
}

type AgendaResponse = {
  timezone: string
  appointments: Appointment[]
}

type PaymentChannel = 'cash' | 'transfer' | 'debit' | 'credit'
const paymentChannels: { value: PaymentChannel; label: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'debit', label: 'Tarjeta de débito' },
  { value: 'credit', label: 'Tarjeta de crédito' },
]

function buildMonth(year: number, month: number) {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7

  return Array.from({ length: cells }, (_, index) => new Date(year, month, index + 1 - offset))
}

function toKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function AppointmentDetailTooltip({ appointment }: { appointment: Appointment }) {
  const detalle = appointment.detalle?.trim() ?? ''
  const notes = appointment.notes?.trim() ?? ''
  const extra = notes && notes !== detalle ? notes : ''

  if (!detalle && !extra) return null

  return (
    <span className="informacion-ayuda-emergente agenda-elemento-detalle">
      <button type="button" className="informacion-ayuda-emergente-boton" aria-label="Ver detalle del turno">
        i
      </button>
      <span className="informacion-ayuda-emergente-contenido" role="tooltip">
        {detalle ? (
          <>
            {extra ? <strong>Detalle</strong> : null}
            {detalle}
          </>
        ) : null}
        {extra ? (
          <>
            {detalle ? <strong>Comentario</strong> : null}
            {extra}
          </>
        ) : null}
      </span>
    </span>
  )
}

export function CalendarPage() {
  const { session } = useAuth()
  const today = new Date()
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selected, setSelected] = useState(() => toKey(today))
  const [data, setData] = useState<AgendaResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [paymentTarget, setPaymentTarget] = useState<Appointment | null>(null)
  const [paymentChannel, setPaymentChannel] = useState<PaymentChannel>('cash')
  const [savingPayment, setSavingPayment] = useState(false)
  const calendarRef = useRef<HTMLElement>(null)
  const agendaPanelRef = useRef<HTMLElement>(null)
  const [agendaPanelHeight, setAgendaPanelHeight] = useState<number | null>(null)

  const days = useMemo(() => buildMonth(cursor.getFullYear(), cursor.getMonth()), [cursor])
  const selectedAppointmentsCount = useMemo(
    () => (data?.appointments ?? []).filter((a) => toKey(new Date(a.startsAt)) === selected).length,
    [data, selected],
  )

  useEffect(() => {
    function syncAgendaLayout() {
      const calendar = calendarRef.current
      if (!calendar) return
      setAgendaPanelHeight(Math.round(calendar.getBoundingClientRect().height))
    }

    syncAgendaLayout()
    const observer = new ResizeObserver(syncAgendaLayout)
    if (calendarRef.current) observer.observe(calendarRef.current)
    window.addEventListener('resize', syncAgendaLayout)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncAgendaLayout)
    }
  }, [cursor, days.length, selected, selectedAppointmentsCount])

  useEffect(() => {
    if (!session || days.length === 0) return

    const from = toKey(days[0])
    const to = toKey(days[days.length - 1])

    apiGet<AgendaResponse>(`/api/appointments?from=${from}&to=${to}`, session.access_token)
      .then((agenda) => {
        setData(agenda)
        setError(null)
      })
      .catch((reason: unknown) => {
        setData(null)
        setError(reason instanceof Error ? reason.message : 'No se pudo cargar la agenda.')
      })
  }, [session, days, refreshKey])

  async function recordAppointmentPayment() {
    if (!session || !paymentTarget || savingPayment) return
    setSavingPayment(true)
    setError(null)
    try {
      await apiPatch(
        `/api/appointments/${paymentTarget.id}/payment`,
        session.access_token,
        { paymentChannel },
      )
      setPaymentTarget(null)
      setRefreshKey((value) => value + 1)
    } catch (reason) {
      setError(reason instanceof Error && reason.message
        ? reason.message
        : 'No se pudo registrar el cobro del turno.')
    } finally {
      setSavingPayment(false)
    }
  }

  const timezone = data?.timezone
  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'short' }),
    [timezone],
  )
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat('es-AR', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }),
    [timezone],
  )

  const byDay = useMemo(() => {
    const groups = new Map<string, Appointment[]>()
    for (const appointment of data?.appointments ?? []) {
      const key = dayFormatter.format(new Date(appointment.startsAt))
      const list = groups.get(key) ?? []
      list.push(appointment)
      groups.set(key, list)
    }
    return groups
  }, [data, dayFormatter])

  const selectedAppointments = byDay.get(selected) ?? []
  const selectedLabel = new Date(`${selected}T12:00:00`).toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  function moveMonth(delta: number) {
    setCursor((value) => new Date(value.getFullYear(), value.getMonth() + delta, 1))
  }

  return (
    <div className="panel">
      <section className="header-panel">
        <div>
          <span className="antetitulo">Agenda</span>
          <h1>Turnos del salón</h1>
          {data ? (
            <p>{`${data.appointments.length} turno${data.appointments.length === 1 ? '' : 's'} en ${MONTHS[cursor.getMonth()].toLowerCase()}`}</p>
          ) : null}
        </div>
      </section>

      {error ? <p className="error">{error}</p> : null}

      <div className="agenda-estructura">
        <section ref={calendarRef} className="tarjeta-panel calendario">
          <header className="calendario-header">
            <div className="calendario-mes">
              <button type="button" className="icono-boton" onClick={() => moveMonth(-1)} aria-label="Mes anterior">
                <span className="agenda-navegacion-anterior">
                  <ChevronRight size={16} strokeWidth={1.8} />
                </span>
              </button>
              <h2>
                {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
              </h2>
              <button type="button" className="icono-boton" onClick={() => moveMonth(1)} aria-label="Mes siguiente">
                <ChevronRight size={16} strokeWidth={1.8} />
              </button>
            </div>

            <button
              type="button"
              className="texto-boton"
              onClick={() => {
                const now = new Date()
                setCursor(new Date(now.getFullYear(), now.getMonth(), 1))
                setSelected(toKey(now))
              }}
            >
              Hoy
            </button>
          </header>

          <div className="calendario-grid" role="presentation">
            {WEEKDAYS.map((weekday) => (
              <span key={weekday} className="calendario-dia-semana">
                {weekday}
              </span>
            ))}

            {days.map((day) => {
              const key = toKey(day)
              const isOutside = day.getMonth() !== cursor.getMonth()
              const isToday = day.toDateString() === today.toDateString()
              const count = (byDay.get(key) ?? []).filter(
                (appointment) => appointment.status !== 'cancelled',
              ).length

              return (
                <button
                  type="button"
                  key={day.toISOString()}
                  onClick={() => setSelected(key)}
                  className={`calendario-dia${isOutside ? ' esta-fuera' : ''}${isToday ? ' esta-hoy' : ''}${
                    key === selected ? ' esta-seleccionado' : ''
                  }`}
                >
                  {day.getDate()}
                  {count > 0 ? <small>{count}</small> : null}
                </button>
              )
            })}
          </div>
        </section>

        <section
          ref={agendaPanelRef}
          className="tarjeta-panel agenda-panel"
          style={
            agendaPanelHeight
              ? { height: agendaPanelHeight, maxHeight: agendaPanelHeight }
              : undefined
          }
        >
          <div className="tarjeta-panel-header">
            <div>
              <h2>{selectedLabel}</h2>
              <p>
                {selectedAppointments.length
                  ? `${selectedAppointments.length} turno${selectedAppointments.length === 1 ? '' : 's'}`
                  : 'Sin turnos'}
              </p>
              <AppointmentBadgeLegend />
            </div>
          </div>

          <div className="agenda-reservas personalizado-desplazamiento">
            {selectedAppointments.length ? (
              <div className="agenda-lista">
                {selectedAppointments.map((appointment) => (
                  <article className="agenda-elemento" key={appointment.id}>
                    <time>
                      {timeFormatter.format(new Date(appointment.startsAt))}
                      <small>{timeFormatter.format(new Date(appointment.endsAt))}</small>
                    </time>
                    <div>
                      <strong>{appointment.customerName}</strong>
                      <span>
                        {appointment.serviceName} · {appointment.staffName}
                      </span>
                      <span>{appointment.customerPhone}</span>
                    </div>
                    <div className="agenda-elemento-datos">
                      <AppointmentDetailTooltip appointment={appointment} />
                      <AppointmentBadges
                        status={appointment.status}
                        paymentMethod={appointment.paymentMethod}
                        paymentStatus={appointment.paymentStatus}
                      />
                      {appointment.paymentMethod === 'salon' && appointment.paymentStatus === 'unpaid'
                        && appointment.status !== 'cancelled' ? (
                          <button
                            type="button"
                            className="agenda-elemento-pago-accion"
                            disabled={savingPayment}
                            onClick={() => {
                              setPaymentChannel('cash')
                              setPaymentTarget(appointment)
                            }}
                          >
                            Registrar cobro
                          </button>
                        ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="vacio-situacion agenda-reservas-vacio">
                <h2>Día libre</h2>
                <p>Elegí otro día en el calendario.</p>
              </div>
            )}
          </div>
        </section>
      </div>
      {paymentTarget ? (
        <div className="modal-fondo" role="presentation">
          <section
            className="modal-tarjeta modal-tarjeta-form"
            role="dialog"
            aria-modal="true"
            aria-labelledby="appointment-payment-title"
          >
            <h2 id="appointment-payment-title">Registrar pago del turno</h2>
            <p>{paymentTarget.customerName} · {paymentTarget.serviceName}</p>
            <p>{paymentTarget.staffName} · {timeFormatter.format(new Date(paymentTarget.startsAt))}</p>
            <label className="turno-pago-metodo">
              Medio de pago
              <select
                value={paymentChannel}
                disabled={savingPayment}
                onChange={(event) => setPaymentChannel(event.target.value as PaymentChannel)}
              >
                {paymentChannels.map((channel) => (
                  <option value={channel.value} key={channel.value}>{channel.label}</option>
                ))}
              </select>
            </label>
            {error ? <p className="error" role="alert">{error}</p> : null}
            <div className="modal-form-acciones">
              <button type="button" className="primary" disabled={savingPayment}
                onClick={() => void recordAppointmentPayment()}>
                {savingPayment ? 'Guardando…' : 'Confirmar pago'}
              </button>
              <button type="button" className="secundario" disabled={savingPayment}
                onClick={() => setPaymentTarget(null)}>Cancelar</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
