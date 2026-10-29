import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { apiGet, apiPatch } from '../lib/api'

type PaymentChannel = 'cash' | 'transfer' | 'debit' | 'credit'
type FinanceTransaction = {
  id: string
  source: 'appointment' | 'product'
  occurredAt: string
  customerName: string
  description: string
  professionalName: string | null
  amount: number
  paymentChannel: string | null
  paymentStatus: string
  recordStatus: string
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })
const channels: { value: PaymentChannel; label: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'debit', label: 'Tarjeta de débito' },
  { value: 'credit', label: 'Tarjeta de crédito' },
]
const channelLabels: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  debit: 'Tarjeta de débito',
  credit: 'Tarjeta de crédito',
  mercadopago: 'Mercado Pago',
  unknown: 'Medio sin registrar',
}
const statusLabels: Record<string, string> = {
  paid: 'Pagado',
  unpaid: 'Sin pagar',
  pending: 'Pago pendiente',
  failed: 'Pago fallido',
  refunded: 'Reembolsado',
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function initialFromDate() {
  const date = new Date()
  return localDate(new Date(date.getFullYear(), date.getMonth(), 1))
}

function initialToDate() {
  return localDate(new Date())
}

function getPaymentTone(status: string) {
  if (status === 'paid') return 'exito'
  if (status === 'failed' || status === 'refunded') return 'peligro'
  if (status === 'pending') return 'pendiente'
  return 'advertencia'
}

function csvCell(value: string) {
  const safeValue = /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safeValue.replaceAll('"', '""')}"`
}

export function PaymentsPage() {
  const { session } = useAuth()
  const token = session?.access_token
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([])
  const [from, setFrom] = useState(initialFromDate)
  const [to, setTo] = useState(initialToDate)
  const [source, setSource] = useState('all')
  const [status, setStatus] = useState('all')
  const [channel, setChannel] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [paymentTarget, setPaymentTarget] = useState<FinanceTransaction | null>(null)
  const [paymentChannel, setPaymentChannel] = useState<PaymentChannel>('cash')

  useEffect(() => {
    if (!token || !from || !to || from > to) return

    let active = true
    const query = new URLSearchParams({ from, to, source, status, channel })
    apiGet<FinanceTransaction[]>(`/api/finance/transactions?${query}`, token)
      .then((items) => {
        if (!active) return
        setTransactions(items)
        setError(null)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(reason instanceof Error && reason.message
          ? reason.message
          : 'No se pudieron cargar los ingresos.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [token, from, to, source, status, channel, revision])

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es')
    if (!term) return transactions
    return transactions.filter((item) =>
      [item.customerName, item.description, item.professionalName ?? '', item.id]
        .some((value) => value.toLocaleLowerCase('es').includes(term)),
    )
  }, [transactions, search])

  function reload() {
    if (!from || !to || from > to) return
    setLoading(true)
    setRevision((value) => value + 1)
  }

  function exportTransactions() {
    const rows = [
      ['Fecha', 'Origen', 'Cliente', 'Detalle', 'Profesional', 'Medio de pago', 'Estado', 'Importe'],
      ...visible.map((item) => [
        new Date(item.occurredAt).toLocaleString('es-AR'),
        item.source === 'appointment' ? 'Turno' : 'Tienda',
        item.customerName,
        item.description,
        item.professionalName ?? '',
        item.paymentChannel ? channelLabels[item.paymentChannel] ?? item.paymentChannel : '',
        statusLabels[item.paymentStatus] ?? item.paymentStatus,
        money.format(item.amount),
      ]),
    ]
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `ingresos-${from}-${to}.csv`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  async function markAsPaid() {
    if (!token || !paymentTarget || busy) return
    setBusy(true)
    setError(null)
    try {
      if (paymentTarget.source === 'appointment') {
        await apiPatch(
          `/api/appointments/${paymentTarget.id}/payment`,
          token,
          { paymentChannel },
        )
      } else {
        await apiPatch(
          `/api/product-orders/${paymentTarget.id}`,
          token,
          { action: 'pay', paymentChannel },
        )
      }
      setPaymentTarget(null)
      reload()
    } catch (reason) {
      setError(reason instanceof Error && reason.message
        ? reason.message
        : 'No se pudo registrar el cobro.')
    } finally {
      setBusy(false)
    }
  }

  const hasInvalidDates = Boolean(from && to && from > to)

  return (
    <div className="pagos-pagina finanzas-pagina">
      <header className="pagos-pagina-header">
        <div>
          <span className="pagos-pagina-antetitulo">FINANZAS</span>
          <h1>Ingresos</h1>
        </div>
        <button
          type="button"
          className="secundario"
          disabled={loading || busy || !from || !to || from > to}
          onClick={reload}
        >
          Actualizar
        </button>
      </header>

      <section className="finanzas-movimientos">
        <div className="finanzas-movimientos-titulo">
          <div>
            <h2>Movimientos</h2>
          </div>
          <div className="finanzas-movimientos-acciones">
            <span>{visible.length} resultados</span>
            <button
              type="button"
              className="secundario"
              disabled={loading || Boolean(error) || hasInvalidDates || visible.length === 0}
              onClick={exportTransactions}
            >
              Exportar CSV
            </button>
          </div>
        </div>

        <div className="finanzas-filtros">
          <label>
            Desde
            <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
          </label>
          <label>
            Origen
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="all">Todos</option>
              <option value="appointment">Turnos</option>
              <option value="product">Tienda</option>
            </select>
          </label>
          <label>
            Estado
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">Todos</option>
              <option value="paid">Pagados</option>
              <option value="unpaid">Sin pagar</option>
              <option value="pending">Pago pendiente</option>
              <option value="failed">Pago fallido</option>
              <option value="refunded">Reembolsados</option>
            </select>
          </label>
          <label>
            Medio de pago
            <select value={channel} onChange={(event) => setChannel(event.target.value)}>
              <option value="all">Todos los medios</option>
              <option value="salon">Pagado en el salón</option>
              {channels.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
              <option value="mercadopago">Mercado Pago</option>
              <option value="unknown">Medio sin registrar</option>
            </select>
          </label>
          <label className="finanzas-filtros-busqueda">
            Buscar
            <input
              type="search"
              value={search}
              placeholder="Cliente, producto o servicio"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        {hasInvalidDates ? <p className="error" role="alert">La fecha inicial debe ser anterior a la fecha final.</p> : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        {!loading && !error && !visible.length ? (
          <div className="vacio-situacion"><p>No hay movimientos con estos filtros.</p></div>
        ) : null}

        {!loading && visible.length > 0 ? (
          <div className="finanzas-tabla-envoltura">
            <table className="finanzas-tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Origen</th>
                  <th>Cliente y detalle</th>
                  <th>Medio</th>
                  <th>Estado</th>
                  <th>Importe</th>
                  <th><span className="solo-lectores">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={`${item.source}-${item.id}`}>
                    <td>{new Date(item.occurredAt).toLocaleString('es-AR')}</td>
                    <td>
                      <span className={`finanzas-origen finanzas-origen-${item.source === 'appointment' ? 'turno' : 'producto'}`}>
                        {item.source === 'appointment' ? 'Turno' : 'Tienda'}
                      </span>
                    </td>
                    <td>
                      <strong>{item.customerName}</strong>
                      <span className="finanzas-tabla-detalle">{item.description}</span>
                      {item.professionalName ? <small>{item.professionalName}</small> : null}
                    </td>
                    <td>{item.paymentChannel ? channelLabels[item.paymentChannel] ?? item.paymentChannel : '—'}</td>
                    <td>
                      <span className={`pedido-estado-etiqueta pedido-estado-etiqueta-${getPaymentTone(item.paymentStatus)}`}>
                        {statusLabels[item.paymentStatus] ?? item.paymentStatus}
                      </span>
                    </td>
                    <td className="finanzas-tabla-importe">{money.format(item.amount)}</td>
                    <td>
                      {item.paymentStatus === 'unpaid' && item.recordStatus !== 'cancelled' ? (
                        <button
                          type="button"
                          className="finanzas-tabla-accion"
                          disabled={busy}
                          onClick={() => {
                            setPaymentChannel('cash')
                            setPaymentTarget(item)
                          }}
                        >
                          Registrar cobro
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {paymentTarget ? (
        <div className="modal-fondo" role="presentation">
          <section className="modal-tarjeta modal-tarjeta-form finanzas-pago-modal" role="dialog" aria-modal="true" aria-labelledby="finance-payment-title">
            <h2 id="finance-payment-title">Registrar cobro</h2>
            <p>{paymentTarget.customerName} · {paymentTarget.description}</p>
            <strong>{money.format(paymentTarget.amount)}</strong>
            <label>
              Medio de pago
              <select value={paymentChannel} disabled={busy} onChange={(event) => setPaymentChannel(event.target.value as PaymentChannel)}>
                {channels.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
              </select>
            </label>
            <p>Al confirmar, el turno o pedido también quedará marcado como pagado.</p>
            {error ? <p className="error" role="alert">{error}</p> : null}
            <div className="modal-form-acciones">
              <button type="button" className="primary" disabled={busy} onClick={() => void markAsPaid()}>
                {busy ? 'Guardando…' : 'Confirmar cobro'}
              </button>
              <button type="button" className="secundario" disabled={busy} onClick={() => setPaymentTarget(null)}>
                Cancelar
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
