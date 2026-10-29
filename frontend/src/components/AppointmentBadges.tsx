const METHOD_LABELS: Record<string, string> = {
  mercadopago: 'Mercado Pago',
  salon: 'En el salón',
}

const PAYMENT_LABELS: Record<string, string> = {
  paid: 'Pagado',
  pending: 'Pago pendiente',
  unpaid: 'Pago pendiente',
  failed: 'Pago pendiente',
  refunded: 'Reembolsado',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
  completed: 'Completado',
  no_show: 'No vino',
}

const STATUS_CLASSES: Record<string, string> = {
  pending: 'estado-pendiente',
  confirmed: 'estado-confirmado',
  cancelled: 'estado-cancelado',
  completed: 'estado-completado',
  no_show: 'estado-ausente',
}

type AppointmentBadgesProps = {
  status: string
  paymentMethod?: string | null
  paymentStatus?: string | null
}

export function AppointmentBadges({
  status,
  paymentMethod,
  paymentStatus,
}: AppointmentBadgesProps) {
  const method = paymentMethod === 'mercadopago' ? 'mercadopago' : 'salon'
  const paid = paymentStatus === 'paid'
  const refunded = paymentStatus === 'refunded'

  return (
    <span className="turno-etiquetas">
      <span className={`estado etiqueta-tipo etiqueta-tipo-metodo estado-metodo-${method}`}>
        {METHOD_LABELS[method]}
      </span>
      <span className={`estado etiqueta-tipo etiqueta-tipo-pago ${paid ? 'estado-pagado' : refunded ? 'estado-cancelado' : 'estado-pendiente'}`}>
        {PAYMENT_LABELS[paymentStatus ?? 'unpaid'] ?? 'Pago pendiente'}
      </span>
      <span className={`estado etiqueta-tipo etiqueta-tipo-turno ${STATUS_CLASSES[status] ?? ''}`}>
        {STATUS_LABELS[status] ?? status}
      </span>
    </span>
  )
}

export function AppointmentBadgeLegend() {
  return (
    <p className="etiqueta-referencias" aria-label="Referencia de badges">
      <span className="etiqueta-referencias-elemento">
        <i className="etiqueta-referencias-punto etiqueta-referencias-punto-metodo" aria-hidden="true" />
        Método de pago
      </span>
      <span className="etiqueta-referencias-elemento">
        <i className="etiqueta-referencias-punto etiqueta-referencias-punto-pago" aria-hidden="true" />
        Pago
      </span>
      <span className="etiqueta-referencias-elemento">
        <i className="etiqueta-referencias-punto etiqueta-referencias-punto-turno" aria-hidden="true" />
        Estado del turno
      </span>
    </p>
  )
}
