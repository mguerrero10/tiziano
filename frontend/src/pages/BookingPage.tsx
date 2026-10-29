import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ShoppingCart } from 'lucide-react'
import mercadoPagoLogo from '../assets/images/mercadopago-logo.png'
import { Brand } from '../components/Brand'
import { ApiError, apiGetPublic, apiPostPublic } from '../lib/api'
import {
  closeMercadoPagoCheckout,
  openMercadoPagoCheckout,
  tryCloseMercadoPagoReturnTab,
} from '../lib/mercadopagoWindow'
import {
  filterHairStylesByAudience,
  resolveHairStyleAudience,
} from '../lib/hairStyleAudience'
import {
  loadHairStyles,
  type HairStyleOption,
} from '../lib/hairStyles'

type SalonData = {
  salon: {
    name: string
    slug: string
    timezone: string
    phone: string | null
    address: string | null
    logoUrl: string | null
  }
  modules: Array<{
    key: string
    name: string
  }>
  services: Array<{
    id: string
    name: string
    description: string | null
    durationMinutes: number
    price: number
    moduleKey: string
    catalogKey?: string | null
  }>
  staff: Array<{
    id: string
    displayName: string
    serviceIds: string[]
  }>
  payments?: {
    mercadoPago: boolean
    testMode?: boolean
  }
  store?: {
    enabled: boolean
    moduleActive?: boolean
  }
}

type PaymentMethod = 'mercadopago' | 'salon'

type CreatedAppointment = {
  id: string
  status: string
  paymentMethod?: string
  paymentStatus?: string
  checkoutUrl?: string | null
}

type AppointmentPayment = {
  id: string
  startsAt: string
  endsAt: string
  status: string
  paymentMethod: string
  paymentStatus: string
  serviceName: string
  staffName: string
  staffId: string
  serviceId: string
  moduleKey: string
}

type Slot = {
  staffId: string
  staffName: string
  startsAt: string
  endsAt: string
}

type Availability = {
  slots: Slot[]
  closed: boolean
  hasStaff: boolean
  timezone: string
  opensAt: string | null
  closesAt: string | null
}

function normalizeAvailability(
  payload: Availability | Slot[] | unknown,
  fallbackTimezone: string,
): Availability {
  if (Array.isArray(payload)) {
    return {
      slots: payload,
      closed: false,
      hasStaff: payload.length > 0,
      timezone: fallbackTimezone,
      opensAt: null,
      closesAt: null,
    }
  }

  const data = payload as Partial<Availability>
  return {
    slots: data.slots ?? [],
    closed: data.closed ?? false,
    hasStaff: data.hasStaff ?? false,
    timezone: data.timezone ?? fallbackTimezone,
    opensAt: data.opensAt ?? null,
    closesAt: data.closesAt ?? null,
  }
}

function formatDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function nextBusinessDate(offset = 1) {
  const value = new Date()
  value.setHours(0, 0, 0, 0)
  value.setDate(value.getDate() + offset)
  while (value.getDay() === 0) {
    value.setDate(value.getDate() + 1)
  }
  return formatDateInput(value)
}

function resetBookingFlow(
  setModuleKey: (value: string) => void,
  setServiceId: (value: string) => void,
  setStaffId: (value: string) => void,
  setAvailability: (value: Availability | null) => void,
  setSelectedSlot: (value: Slot | null) => void,
  moduleKey = '',
) {
  setModuleKey(moduleKey)
  setServiceId('')
  setStaffId('')
  setAvailability(null)
  setSelectedSlot(null)
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('No se pudo leer la imagen.'))
    image.src = url
  })
}

async function compressImageForPreview(file: File, maxEdge = 1024, quality = 0.82) {
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url)
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('No se pudo procesar la imagen.')
    }
    context.drawImage(image, 0, 0, width, height)
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    return {
      base64: dataUrl.split(',')[1] ?? '',
      mimeType: 'image/jpeg',
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function BookingPage() {
  const { slug = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const paymentReturnHandled = useRef(false)
  const mpWindowRef = useRef<Window | null>(null)
  const [data, setData] = useState<SalonData | null>(null)
  const [moduleKey, setModuleKey] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [date, setDate] = useState(nextBusinessDate())
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [appointmentId, setAppointmentId] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [selfieFile, setSelfieFile] = useState<File | null>(null)
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null)
  const [hairPreviewMode, setHairPreviewMode] = useState<'catalog' | 'custom'>('catalog')
  const [referenceFile, setReferenceFile] = useState<File | null>(null)
  const [referencePreview, setReferencePreview] = useState<string | null>(null)
  const [hairStyles, setHairStyles] = useState<HairStyleOption[]>([])
  const [styleId, setStyleId] = useState('')
  const [styleNotes, setStyleNotes] = useState('')
  const [hairPreviewUrl, setHairPreviewUrl] = useState<string | null>(null)
  const [previewProvider, setPreviewProvider] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [stylePickerOpen, setStylePickerOpen] = useState(false)
  const [hairStylesLoading, setHairStylesLoading] = useState(false)
  const [hairStylesError, setHairStylesError] = useState<string | null>(null)
  const [previewRetryUntil, setPreviewRetryUntil] = useState<number | null>(null)
  const [previewCooldownSeconds, setPreviewCooldownSeconds] = useState(0)
  const [remainingPreviews, setRemainingPreviews] = useState<number | null>(null)
  const [hairPreviewPanelOpen, setHairPreviewPanelOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('')
  const [, setConfirmedPaymentMethod] = useState<string | null>(null)
  const [confirmedPaymentStatus, setConfirmedPaymentStatus] = useState<string | null>(null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const [awaitingPayment, setAwaitingPayment] = useState(false)

  const clearHairPreview = useCallback(() => {
    setHairPreviewUrl(null)
    setPreviewProvider(null)
    setPreviewError(null)
  }, [])

  const refreshHairStyles = useCallback(async () => {
    setHairStylesLoading(true)
    setHairStylesError(null)
    try {
      const styles = await loadHairStyles(
        () => apiGetPublic<HairStyleOption[]>('/api/public/hair-styles'),
      )
      setHairStyles(styles)
    } catch (reason: unknown) {
      const message = reason instanceof Error
        ? reason.message
        : 'No se pudo cargar el catálogo de cortes.'
      setHairStyles([])
      setHairStylesError(message)
    } finally {
      setHairStylesLoading(false)
    }
  }, [])

  const openHairStylePicker = useCallback(() => {
    setStylePickerOpen(true)
    void refreshHairStyles()
  }, [refreshHairStyles])

  useEffect(() => {
    if (stylePickerOpen) {
      void refreshHairStyles()
    }
  }, [stylePickerOpen, refreshHairStyles])

  useEffect(() => {
    apiGetPublic<SalonData>(`/api/public/salons/${slug}`)
      .then((salon) => {
        setData(salon)
        if (salon.modules.length === 1) {
          setModuleKey(salon.modules[0].key)
        }
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'No se encontró la peluquería.')
      })
  }, [slug])

  const moduleServices = useMemo(
    () => data?.services.filter((service) => service.moduleKey === moduleKey) ?? [],
    [data, moduleKey],
  )

  const availableStaff = useMemo(
    () => data?.staff.filter((person) => person.serviceIds.includes(serviceId)) ?? [],
    [data, serviceId],
  )

  const selectedModule = data?.modules.find((module) => module.key === moduleKey)
  const selectedService = data?.services.find((service) => service.id === serviceId)
  const isHairService = selectedService?.moduleKey === 'hair'
  const mercadoPagoEnabled = data?.payments?.mercadoPago === true
  const mercadoPagoTestMode = data?.payments?.testMode === true
  const showPaymentStep = (selectedService?.price ?? 0) > 0
  const formattedPrice = selectedService
    ? selectedService.price.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })
    : ''

  const hairStyleAudience = useMemo(
    () => resolveHairStyleAudience({
      catalogKey: selectedService?.catalogKey,
      name: selectedService?.name,
      moduleKey: selectedService?.moduleKey,
    }),
    [selectedService],
  )
  const visibleHairStyles = useMemo(
    () => filterHairStylesByAudience(hairStyles, hairStyleAudience),
    [hairStyles, hairStyleAudience],
  )

  useEffect(() => {
    if (!selfieFile) {
      setSelfiePreview(null)
      return
    }
    const url = URL.createObjectURL(selfieFile)
    setSelfiePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [selfieFile])

  useEffect(() => {
    if (!referenceFile) {
      setReferencePreview(null)
      return
    }
    const url = URL.createObjectURL(referenceFile)
    setReferencePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [referenceFile])

  useEffect(() => {
    setSelfieFile(null)
    setReferenceFile(null)
    setHairPreviewMode('catalog')
    setStyleId('')
    setStyleNotes('')
    clearHairPreview()
    setPreviewRetryUntil(null)
    setRemainingPreviews(null)
  }, [serviceId, clearHairPreview])

  const selectedHairStyle = useMemo(
    () => visibleHairStyles.find((style) => style.id === Number(styleId)),
    [visibleHairStyles, styleId],
  )

  useEffect(() => {
    if (!styleId || visibleHairStyles.some((style) => String(style.id) === styleId)) {
      return
    }

    setStyleId('')
    clearHairPreview()
  }, [styleId, visibleHairStyles, clearHairPreview])

  useEffect(() => {
    if (!previewRetryUntil) {
      setPreviewCooldownSeconds(0)
      return
    }

    function tick() {
      const remaining = Math.max(0, Math.ceil((previewRetryUntil as number - Date.now()) / 1000))
      setPreviewCooldownSeconds(remaining)
      if (remaining === 0) {
        setPreviewRetryUntil(null)
      }
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [previewRetryUntil])

  useEffect(() => {
    if (!serviceId || !date || !moduleKey) {
      setAvailability(null)
      return
    }

    setAvailability(null)
    const staffQuery = staffId ? `&staffId=${staffId}` : ''
    apiGetPublic<Availability | Slot[]>(
      `/api/public/salons/${slug}/availability?serviceId=${serviceId}&date=${date}${staffQuery}`,
    )
      .then((payload) => setAvailability(normalizeAvailability(payload, data?.salon.timezone ?? 'UTC')))
      .catch((reason: unknown) => {
        setAvailability({ slots: [], closed: false, hasStaff: false, timezone: data?.salon.timezone ?? 'UTC', opensAt: null, closesAt: null })
        setError(reason instanceof Error ? reason.message : 'No se pudo consultar la agenda.')
      })
  }, [slug, serviceId, staffId, date, reloadToken, moduleKey, data?.salon.timezone])

  function chooseModule(key: string) {
    resetBookingFlow(setModuleKey, setServiceId, setStaffId, setAvailability, setSelectedSlot, key)
    setSuccess(false)
    setError(null)
  }

  function chooseService(id: string) {
    setServiceId(id)
    setStaffId('')
    setAvailability(null)
    setSelectedSlot(null)
    setDate(nextBusinessDate())
    setSuccess(false)
    setError(null)
    setPaymentMethod('')
    setAppointmentId(null)
    setConfirmedPaymentMethod(null)
    setConfirmedPaymentStatus(null)
    setCheckoutUrl(null)
    setAwaitingPayment(false)
  }

  useEffect(() => {
    if (!showPaymentStep || !mercadoPagoEnabled) {
      setPaymentMethod('salon')
    }
  }, [showPaymentStep, mercadoPagoEnabled, serviceId])

  useEffect(() => {
    const pago = searchParams.get('pago')
    const turno = searchParams.get('turno')
    if (!slug || !pago || !turno || paymentReturnHandled.current) {
      return
    }

    paymentReturnHandled.current = true
    const paymentId = searchParams.get('payment_id') || searchParams.get('collection_id') || ''
    const query = paymentId ? `?paymentId=${encodeURIComponent(paymentId)}` : ''
    console.info('[pago] vuelta de Mercado Pago', {
      pago,
      turno,
      paymentId,
      query: Object.fromEntries(searchParams.entries()),
    })

    apiGetPublic<AppointmentPayment>(`/api/public/salons/${slug}/appointments/${turno}/payment${query}`)
      .then((appointment) => {
        console.info('[pago] estado al volver', appointment)
        setAppointmentId(appointment.id)
        setConfirmedPaymentMethod(appointment.paymentMethod)
        setConfirmedPaymentStatus(appointment.paymentStatus)
        setSelectedSlot({
          staffId: appointment.staffId,
          staffName: appointment.staffName,
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
        })
        if (appointment.moduleKey) {
          setModuleKey(appointment.moduleKey)
        }
        if (appointment.serviceId) {
          setServiceId(appointment.serviceId)
        }
        setError(null)
        if (appointment.paymentStatus === 'paid') {
          setAwaitingPayment(false)
          setSuccess(true)
        } else {
          setSuccess(false)
          setAwaitingPayment(true)
          if (pago === 'error') {
            setError('El pago no se completo, intentar de nuevo con Mercado Pago.')
          }
        }
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'No se pudo verificar el pago.')
      })
      .finally(() => {
        setSearchParams({}, { replace: true })
        tryCloseMercadoPagoReturnTab()
      })
  }, [searchParams, setSearchParams, slug])

  useEffect(() => {
    if (!awaitingPayment || !appointmentId || !slug) {
      return
    }

    let cancelled = false

    async function syncPayment() {
      try {
        const appointment = await apiGetPublic<AppointmentPayment>(
          `/api/public/salons/${slug}/appointments/${appointmentId}/payment`,
        )
        console.info('[pago] sync', {
          status: appointment.status,
          paymentStatus: appointment.paymentStatus,
          paymentMethod: appointment.paymentMethod,
        })
        if (cancelled) return
        setConfirmedPaymentMethod(appointment.paymentMethod)
        setConfirmedPaymentStatus(appointment.paymentStatus)
        if (appointment.paymentStatus === 'paid') {
          setAwaitingPayment(false)
          setCheckoutUrl(null)
          setSuccess(true)
          closeMercadoPagoCheckout(mpWindowRef.current)
          mpWindowRef.current = null
        }
      } catch {
      }
    }

    void syncPayment()
    const timer = window.setInterval(() => {
      void syncPayment()
    }, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [awaitingPayment, appointmentId, slug])

  async function simulatePayment(fallbackMessage: string) {
    if (!appointmentId) return

    console.info('[pago] simular pago aprobado', appointmentId)
    try {
      const appointment = await apiPostPublic<AppointmentPayment>(
        `/api/public/salons/${slug}/appointments/${appointmentId}/payment/demo`,
        {},
      )
      console.info('[pago] simulación OK', appointment)
      setConfirmedPaymentMethod(appointment.paymentMethod)
      setConfirmedPaymentStatus(appointment.paymentStatus)
      setAwaitingPayment(false)
      setCheckoutUrl(null)
      closeMercadoPagoCheckout(mpWindowRef.current)
      mpWindowRef.current = null
      setSuccess(true)
    } catch (reason: unknown) {
      console.error('[pago] simulación falló', reason)
      setError(reason instanceof Error ? reason.message : fallbackMessage)
    }
  }

  async function generateHairPreview() {
    if (!appointmentId) {
      setPreviewError('Confirmá el turno para usar la vista previa.')
      return
    }

    if (!selfieFile) {
      setPreviewError('Subí una selfie.')
      return
    }

    if (hairPreviewMode === 'catalog' && !styleId) {
      setPreviewError('Elegi un estilo o carga la foto con el estilo que queres.')
      return
    }

    if (hairPreviewMode === 'custom' && !referenceFile) {
      setPreviewError('Subi una foto con el corte que queres.')
      return
    }

    if (previewCooldownSeconds > 0) {
      return
    }

    setPreviewLoading(true)
    clearHairPreview()
    try {
      const { base64, mimeType } = await compressImageForPreview(selfieFile)
      const payload: {
        appointmentId: string
        imageBase64: string
        mimeType: string
        styleId: number
        styleNotes: string | null
        referenceImageBase64?: string
        referenceMimeType?: string
      } = {
        appointmentId,
        imageBase64: base64,
        mimeType,
        styleId: hairPreviewMode === 'catalog' ? Number(styleId) : 0,
        styleNotes: styleNotes.trim() || null,
      }

      if (hairPreviewMode === 'custom' && referenceFile) {
        const reference = await compressImageForPreview(referenceFile)
        payload.referenceImageBase64 = reference.base64
        payload.referenceMimeType = reference.mimeType
      }

      const result = await apiPostPublic<{
        mimeType: string
        imageBase64: string
        provider?: string
        customReference?: boolean
        remainingPreviews?: number
      }>(
        `/api/public/salons/${slug}/hair-preview`,
        payload,
      )
      setHairPreviewUrl(`data:${result.mimeType};base64,${result.imageBase64}`)
      setPreviewProvider(result.provider ?? null)
      if (typeof result.remainingPreviews === 'number') {
        setRemainingPreviews(result.remainingPreviews)
      }
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 429) {
        if (reason.message.includes('vistas previas incluidas')) {
          setRemainingPreviews(0)
        } else {
          const waitSeconds = reason.retryAfterSeconds ?? 60
          setPreviewRetryUntil(Date.now() + waitSeconds * 1000)
        }
      }
      setPreviewError(reason instanceof Error ? reason.message : 'No se pudo generar la vista previa.')
    } finally {
      setPreviewLoading(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedSlot || submitting || success) return
    if (showPaymentStep && !paymentMethod) {
      setError('Elegí un método de pago.')
      return
    }
    setError(null)
    setSubmitting(true)

    const form = new FormData(event.currentTarget)
    const extraNotes = String(form.get('notes') ?? '').trim()
    const chosenPayment = showPaymentStep && paymentMethod ? paymentMethod : 'salon'
    const bookingPayload = {
      serviceId,
      staffId: selectedSlot.staffId,
      startsAt: selectedSlot.startsAt,
      customerName: form.get('name'),
      customerPhone: form.get('phone'),
      customerEmail: form.get('email'),
      notes: extraNotes || null,
      paymentMethod: chosenPayment,
    }
    console.info('[pago] enviando reserva', bookingPayload)

    try {
      const created = await apiPostPublic<CreatedAppointment>(`/api/public/salons/${slug}/appointments`, bookingPayload)
      console.info('[pago] respuesta API', created)
      setAppointmentId(created.id)
      setConfirmedPaymentMethod(created.paymentMethod ?? chosenPayment)
      setConfirmedPaymentStatus(created.paymentStatus ?? null)
      if (created.checkoutUrl) {
        setCheckoutUrl(created.checkoutUrl)
        setAwaitingPayment(true)
        const host = window.location.hostname
        const canAutoReturn = window.location.protocol === 'https:'
          && host !== 'localhost'
          && host !== '127.0.0.1'
        console.info('[pago] abriendo Mercado Pago', {
          checkoutUrl: created.checkoutUrl,
          canAutoReturn,
          host,
          protocol: window.location.protocol,
        })
        if (canAutoReturn) {
          window.location.assign(created.checkoutUrl)
          return
        }
        mpWindowRef.current = openMercadoPagoCheckout(created.checkoutUrl)
        console.info('[pago] popup', mpWindowRef.current ? 'abierto' : 'bloqueado por el navegador')
      } else {
        setSuccess(true)
      }
    } catch (reason) {
      console.error('[pago] error al crear el turno/pago', reason)
      setError(reason instanceof Error ? reason.message : 'No se pudo confirmar el turno.')
      if (chosenPayment !== 'mercadopago') {
        setSelectedSlot(null)
      }
    } finally {
      setSubmitting(false)
      setAvailability(null)
      setReloadToken((value) => value + 1)
    }
  }

  const closeConfirmation = useCallback(() => {
    setSuccess(false)
    setStylePickerOpen(false)
    setHairPreviewPanelOpen(false)
    resetBookingFlow(setModuleKey, setServiceId, setStaffId, setAvailability, setSelectedSlot)
    setPaymentMethod('')
    setConfirmedPaymentMethod(null)
    setConfirmedPaymentStatus(null)
    setCheckoutUrl(null)
    setAwaitingPayment(false)
    closeMercadoPagoCheckout(mpWindowRef.current)
    mpWindowRef.current = null
    if (data?.modules.length === 1) {
      setModuleKey(data.modules[0].key)
    }
    setDate(nextBusinessDate())
    setReloadToken((value) => value + 1)
  }, [data])

  useEffect(() => {
    if (!success) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (stylePickerOpen) {
        setStylePickerOpen(false)
        return
      }
      if (hairPreviewPanelOpen) {
        setHairPreviewPanelOpen(false)
        return
      }
      closeConfirmation()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [success, stylePickerOpen, hairPreviewPanelOpen, closeConfirmation])

  const slots = availability?.slots ?? null

  function availabilityMessage() {
    if (availability === null) return 'Buscando horarios…'
    if (availability.closed) return 'El salón está cerrado este día. Probá de lunes a sábado.'
    if (staffId && !availability.hasStaff) {
      return 'No hay profesionales asignados a este servicio todavía.'
    }
    if ((availability.slots?.length ?? 0) === 0) {
      if (!staffId) {
        return `No hay horarios entre ${availability.opensAt} y ${availability.closesAt}.`
      }
      return `Sin turnos libres entre ${availability.opensAt} y ${availability.closesAt} para este profesional.`
    }
    return null
  }

  if (error && !data) {
    return (
      <main className="reserva-contenedor">
        <section className="reserva-tarjeta vacio-situacion">
          <Brand compact />
          <h1>Portal no disponible</h1>
          <p>{error}</p>
        </section>
      </main>
    )
  }

  if (!data) {
    return <main className="reserva-contenedor"><span className="aplicacion-carga-simbolo" /></main>
  }

  const timeFormatter = new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: data.salon.timezone,
  })

  const showModuleStep = data.modules.length > 1

  return (
    <main className="reserva-contenedor">
      <header className="reserva-header">
        <div className="reserva-header-inicio">
          {data.salon.logoUrl ? (
            <img className="reserva-header-logotipo" src={data.salon.logoUrl} alt={data.salon.name} />
          ) : (
            <Brand compact />
          )}
        </div>
        <div className="reserva-header-final">
          {data.store?.enabled ? (
            <Link className="reserva-header-tienda" to={`/s/${data.salon.slug}/tienda`}>
              <ShoppingCart size={20} strokeWidth={1.8} />
              <span>Tienda</span>
            </Link>
          ) : null}
          <div className="reserva-header-datos">
            <strong>{data.salon.name}</strong>
            <span>{data.salon.address || 'Reservas online'}</span>
          </div>
        </div>
      </header>

      <section className="reserva-tarjeta">
        {awaitingPayment && selectedSlot && !success ? (
          <div className="modal-fondo" role="presentation">
            <div
              className="modal-tarjeta reserva-confirmar-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="booking-payment-title"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="reserva-pagos-marca reserva-pagos-marca-grande" aria-hidden="true">MP</span>
              <h2 id="booking-payment-title">Completá el pago</h2>
              <p>
                Completa el pago para confirmar tu turno.
                {' '}
                {selectedService?.name ?? 'tu turno'}
                {' '}
                del {new Date(selectedSlot.startsAt).toLocaleDateString('es-AR', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  timeZone: data.salon.timezone,
                })} a las {timeFormatter.format(new Date(selectedSlot.startsAt))}.
              </p>
              {checkoutUrl ? (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    console.info('[pago] reabrir Mercado Pago', checkoutUrl)
                    mpWindowRef.current = openMercadoPagoCheckout(checkoutUrl)
                  }}
                >
                  Reabrir Mercado Pago
                </button>
              ) : null}
              {mercadoPagoTestMode && appointmentId ? (
                <button
                  type="button"
                  className="secundario"
                  onClick={() => void simulatePayment('')}
                >
                  Simular pago aprobado
                </button>
              ) : null}
              <p className="atenuado">
                {mercadoPagoTestMode
                  ? 'Simulación del pago aprobado.'
                  : 'El horario queda reservado 20 minutos mientras se acredita el pago.'}
              </p>
            </div>
          </div>
        ) : null}

        {success && selectedSlot ? (
          <div
            className="modal-fondo modal-fondo-desplazable"
            role="presentation"
          >
          <div
            className={isHairService && appointmentId && hairPreviewPanelOpen
              ? 'modal-tarjeta modal-tarjeta-amplio reserva-confirmar-modal reserva-confirmar-modal-vista-previa'
              : 'modal-tarjeta reserva-confirmar-modal'}
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="booking-confirm-title">Turno confirmado!</h2>
            <p>
              Te esperamos el {new Date(selectedSlot.startsAt).toLocaleDateString('es-AR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                timeZone: data.salon.timezone,
              })} a las {timeFormatter.format(new Date(selectedSlot.startsAt))}.
              {confirmedPaymentStatus === 'paid'
                ? ' Pagaste con Mercado Pago.'
                : ' El horario ya está reservado. Si no pagas online, se debera pagar en el salon.'}
            </p>
            {checkoutUrl && confirmedPaymentStatus !== 'paid' ? (
              <div className="reserva-confirmar-modal-acciones">
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    mpWindowRef.current = openMercadoPagoCheckout(checkoutUrl)
                  }}
                >
                  Pagar con Mercado Pago
                </button>
                {mercadoPagoTestMode && appointmentId ? (
                  <button
                    type="button"
                    className="secundario"
                    onClick={() => void simulatePayment('No se pudo simular el pago.')}
                  >
                    Simular pago aprobado
                  </button>
                ) : null}
              </div>
            ) : null}

            {isHairService && appointmentId ? (
              hairPreviewPanelOpen ? (
              <div className="cabello-vista-previa-bloque">
                <div className="cabello-vista-previa-bloque-header">
                  <strong className="reserva-paso">Vista previa del corte</strong>
                  <button
                    type="button"
                    className="texto-boton"
                    onClick={() => setHairPreviewPanelOpen(false)}
                  >
                    Ocultar
                  </button>
                </div>
                <p className="atenuado cabello-vista-previa-bloque-introduccion">
                  Subi una selfie. Elegi tu estilo del catálogo o una foto de referencia del corte.
                  {' '}
                  <span className="informacion-ayuda-emergente">
                    <button
                      type="button"
                      className="informacion-ayuda-emergente-boton"
                      aria-label="Información sobre vistas previas"
                    >
                      i
                    </button>
                    <span className="informacion-ayuda-emergente-contenido" role="tooltip">
                      Incluye hasta 2 vistas previas con este turno.
                    </span>
                  </span>
                </p>
                <div className="cabello-vista-previa-modo" role="radiogroup" aria-label="Tipo de vista previa">
                  <label className="cabello-vista-previa-modo-opcion">
                    <input
                      type="radio"
                      name="hairPreviewMode"
                      checked={hairPreviewMode === 'catalog'}
                      onChange={() => {
                        setHairPreviewMode('catalog')
                        setReferenceFile(null)
                        clearHairPreview()
                      }}
                    />
                    <span>Vista previa a partir de catálogo</span>
                  </label>
                  <label className="cabello-vista-previa-modo-opcion">
                    <input
                      type="radio"
                      name="hairPreviewMode"
                      checked={hairPreviewMode === 'custom'}
                      onChange={() => {
                        setHairPreviewMode('custom')
                        setStyleId('')
                        clearHairPreview()
                      }}
                    />
                    <span>Vista previa a partir de imagen de referencia</span>
                  </label>
                </div>
                <label className="cabello-vista-previa-carga">
                  Selfie
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      setSelfieFile(event.target.files?.[0] ?? null)
                      clearHairPreview()
                    }}
                  />
                </label>
                {hairPreviewMode === 'catalog' ? (
                <div className="cabello-vista-previa-modo-panel cabello-estilo-selector">
                  <span className="cabello-estilo-selector-rotulo">Estilo de corte</span>
                  {selectedHairStyle ? (
                    <div className="cabello-estilo-seleccionado">
                      {selectedHairStyle.thumbUrl ? (
                        <img
                          className="cabello-estilo-seleccionado-miniatura"
                          src={selectedHairStyle.thumbUrl}
                          alt={selectedHairStyle.name}
                        />
                      ) : (
                        <div className="cabello-estilo-seleccionado-miniatura cabello-estilo-seleccionado-miniatura-vacio">
                          {selectedHairStyle.name.slice(0, 1)}
                        </div>
                      )}
                      <div className="cabello-estilo-seleccionado-texto">
                        <strong>{selectedHairStyle.name}</strong>
                        <span className="atenuado">{selectedHairStyle.group}</span>
                      </div>
                      <button
                        type="button"
                        className="secundario cabello-estilo-seleccionado-cambiar"
                        onClick={openHairStylePicker}
                      >
                        Cambiar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="cabello-vista-previa-archivo-similar cabello-estilo-selector-abierto"
                      onClick={openHairStylePicker}
                    >
                      Ver catálogo de cortes ({visibleHairStyles.length})
                    </button>
                  )}
                  <p className="atenuado cabello-estilo-selector-ayuda">
                    Mira la referencia del corte antes de generar la vista previa en tu foto.
                  </p>
                  {hairStylesLoading ? (
                    <p className="atenuado">Actualizando catálogo de cortes…</p>
                  ) : null}
                  {hairStylesError ? (
                    <p className="error">{hairStylesError}</p>
                  ) : null}
                </div>
                ) : (
                  <div className="cabello-vista-previa-modo-panel">
                    <label className="cabello-vista-previa-carga">
                      Imagen de referencia del corte
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) => {
                          setReferenceFile(event.target.files?.[0] ?? null)
                          clearHairPreview()
                        }}
                      />
                    </label>
                    <p className="atenuado cabello-estilo-selector-ayuda">
                      Subí una foto donde se vea claro el corte que queres).
                    </p>
                  </div>
                )}
                {hairPreviewMode === 'catalog' && stylePickerOpen ? (
                  <div
                    className="modal-fondo modal-fondo-anidado"
                    role="presentation"
                    onClick={(event) => {
                      event.stopPropagation()
                      setStylePickerOpen(false)
                    }}
                  >
                    <div
                      className="modal-tarjeta modal-tarjeta-amplio cabello-estilo-modal personalizado-desplazamiento"
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="hair-style-modal-title"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="cabello-estilo-modal-header">
                        <div>
                          <h2 id="hair-style-modal-title">
                            Catálogo de cortes ({visibleHairStyles.length})
                            {hairStyleAudience ? ` · ${hairStyleAudience}` : ''}
                          </h2>
                          <p className="atenuado">
                            {hairStyleAudience
                              ? `Estilos para servicios de peluquería ${hairStyleAudience.toLowerCase()}.`
                              : 'Elegí un estilo de referencia. Después podés ver cómo te quedaría con tu selfie.'}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="secundario"
                          onClick={() => setStylePickerOpen(false)}
                        >
                          Cerrar
                        </button>
                      </div>
                      {hairStylesError ? (
                        <p className="error">{hairStylesError}</p>
                      ) : null}
                      {hairStylesLoading ? null : visibleHairStyles.length === 0 ? (
                        <p className="atenuado">No hay estilos disponibles para este servicio.</p>
                      ) : (
                        <div className="cabello-estilo-catalogo">
                          {visibleHairStyles.map((style) => (
                            <button
                              type="button"
                              key={style.id}
                              className={
                                String(styleId) === String(style.id)
                                  ? 'cabello-estilo-tarjeta esta-seleccionado'
                                  : 'cabello-estilo-tarjeta'
                              }
                              onClick={() => {
                                setStyleId(String(style.id))
                                clearHairPreview()
                                setStylePickerOpen(false)
                              }}
                            >
                              {style.thumbUrl ? (
                                <img src={style.thumbUrl} alt={style.name} loading="lazy" />
                              ) : (
                                <div className="cabello-estilo-tarjeta-marcador">{style.name}</div>
                              )}
                              <span>{style.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
                <label>
                  Detalle extra (opcional)
                  <input
                    value={styleNotes}
                    onChange={(event) => setStyleNotes(event.target.value)}
                    placeholder="Ej.: más corto atrás, flequillo lateral"
                  />
                </label>
                <button
                  type="button"
                  className="primary cabello-vista-previa-enviar"
                  disabled={
                    previewLoading
                    || previewCooldownSeconds > 0
                    || remainingPreviews === 0
                    || !selfieFile
                    || (hairPreviewMode === 'catalog' && !styleId)
                    || (hairPreviewMode === 'custom' && !referenceFile)
                  }
                  onClick={() => void generateHairPreview()}
                >
                  {previewLoading
                    ? 'Generando vista previa…'
                    : remainingPreviews === 0
                      ? 'Sin vistas previas restantes'
                      : previewCooldownSeconds > 0
                        ? `Reintentar en ${previewCooldownSeconds}s`
                        : 'Ver vista previa'}
                </button>
                {remainingPreviews === 1 ? (
                  <p className="atenuado">Te queda 1 vista previa en este turno.</p>
                ) : null}
                {previewError ? (
                  <p className="error">{previewError}</p>
                ) : null}
                {(selfiePreview || referencePreview || hairPreviewUrl) ? (
                  <div className="cabello-vista-previa-grid">
                    {selfiePreview ? (
                      <figure>
                        <img src={selfiePreview} alt="Selfie original" />
                        <figcaption>Selfie</figcaption>
                      </figure>
                    ) : null}
                    {referencePreview ? (
                      <figure>
                        <img src={referencePreview} alt="Referencia del corte" />
                        <figcaption>Referencia</figcaption>
                      </figure>
                    ) : null}
                    {hairPreviewUrl ? (
                      <figure>
                        <img src={hairPreviewUrl} alt="Vista previa del corte" />
                        <figcaption>
                          {previewProvider === 'youcam-custom'
                            ? 'Vista previa (referencia)'
                            : 'Vista previa (YouCam)'}
                        </figcaption>
                      </figure>
                    ) : null}
                  </div>
                ) : null}
              </div>
              ) : (
                <button
                  type="button"
                  className="cabello-vista-previa-oferta"
                  onClick={() => {
                    setHairPreviewPanelOpen(true)
                    void refreshHairStyles()
                  }}
                >
                  Queres una vista previa de tu corte?
                </button>
              )
            ) : null}

            <div className="reserva-confirmar-modal-acciones">
              <button type="button" className="primary" onClick={closeConfirmation}>
                Cerrar
              </button>
            </div>
          </div>
          </div>
        ) : null}

            <div className="reserva-titulo">
              <h1>Reserva online</h1>
            </div>

            {showModuleStep ? (
              <div className="reserva-seccion">
                <strong className="reserva-paso">1. ¿Qué servicio buscás?</strong>
                <div className="reserva-modulos">
                  {data.modules.map((module) => (
                    <button
                      type="button"
                      key={module.key}
                      className={module.key === moduleKey ? 'esta-seleccionado' : ''}
                      onClick={() => chooseModule(module.key)}
                    >
                      <strong>{module.name}</strong>
                      <small>
                        {data.services.filter((service) => service.moduleKey === module.key).length} servicios
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {moduleKey ? (
              <>
                <div className="reserva-seccion">
                  <div className="reserva-seccion-header">
                    <strong className="reserva-paso">
                      {showModuleStep ? '2. Servicio' : '1. Servicio'}
                      {selectedModule ? ` · ${selectedModule.name}` : ''}
                    </strong>
                    {showModuleStep ? (
                      <button type="button" className="texto-boton" onClick={() => chooseModule('')}>
                        Cambiar rubro
                      </button>
                    ) : null}
                  </div>
                  <div className="reserva-servicios">
                    {moduleServices.map((service) => (
                      <button
                        type="button"
                        key={service.id}
                        className={service.id === serviceId ? 'esta-seleccionado' : ''}
                        onClick={() => chooseService(service.id)}
                      >
                        <span>
                          <strong>{service.name}</strong>
                          <small>{service.durationMinutes} min</small>
                        </span>
                        <b>{service.price.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}</b>
                      </button>
                    ))}
                  </div>
                  {moduleServices.length === 0 ? (
                    <p className="atenuado">No hay servicios disponibles.</p>
                  ) : null}
                </div>

                {serviceId ? (
                  <>
                    {selectedService ? (
                      <p className="reserva-ayuda">
                        {selectedService.name} · {selectedService.durationMinutes} min
                        {availability?.opensAt && availability?.closesAt && !availability.closed
                          ? ` · Atención ${availability.opensAt}–${availability.closesAt}`
                          : ' · Lun–Sáb'}
                      </p>
                    ) : null}

                    <div className="reserva-campos">
                      <label>
                        {showModuleStep ? '3. Profesional' : '2. Profesional'}
                        <select value={staffId} onChange={(event) => {
                          setStaffId(event.target.value)
                          setAvailability(null)
                          setSelectedSlot(null)
                        }}>
                          <option value="">Cualquier profesional</option>
                          {availableStaff.map((person) => (
                            <option value={person.id} key={person.id}>{person.displayName}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {showModuleStep ? '4. Fecha' : '3. Fecha'}
                        <input
                          type="date"
                          min={formatDateInput(new Date())}
                          value={date}
                          onChange={(event) => {
                            setDate(event.target.value)
                            setAvailability(null)
                            setSelectedSlot(null)
                          }}
                        />
                      </label>
                    </div>

                    <div className="reserva-seccion">
                      <strong className="reserva-paso">
                        {showModuleStep ? '5. Horario' : '4. Horario'}
                      </strong>
                      {availabilityMessage() ? (
                        <p className="atenuado">{availabilityMessage()}</p>
                      ) : null}
                      {slots && slots.length > 0 ? (
                        <div className="horario-grid">
                          {slots.map((slot) => (
                            <button
                              type="button"
                              key={`${slot.staffId}-${slot.startsAt}`}
                              className={selectedSlot === slot ? 'esta-seleccionado' : ''}
                              onClick={() => setSelectedSlot(slot)}
                              title={slot.staffName}
                            >
                              {timeFormatter.format(new Date(slot.startsAt))}
                              <small>{slot.staffName}</small>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    {selectedSlot ? (
                      <form className="reserva-form" onSubmit={submit}>
                        {showPaymentStep ? (
                          <div className="reserva-seccion reserva-seccion-pago">
                            <strong className="reserva-paso">
                              {showModuleStep ? '6. Método de pago' : '5. Método de pago'}
                            </strong>
                            <div className="reserva-pagos">
                              {mercadoPagoEnabled ? (
                                <button
                                  type="button"
                                  className={paymentMethod === 'mercadopago' ? 'esta-seleccionado' : ''}
                                  onClick={() => {
                                    setPaymentMethod('mercadopago')
                                    setError(null)
                                  }}
                                >
                                  <img
                                    className="reserva-pagos-logotipo"
                                    src={mercadoPagoLogo}
                                    alt="Mercado Pago"
                                  />
                                  <span>
                                    <small>Tarjeta, débito o dinero en cuenta</small>
                                  </span>
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className={paymentMethod === 'salon' ? 'esta-seleccionado' : ''}
                                onClick={() => {
                                  setPaymentMethod('salon')
                                  setError(null)
                                }}
                              >
                                <span>
                                  <strong>Pagar en el salón</strong>
                                  <small>Reservás ahora y pagás el día del turno</small>
                                </span>
                              </button>
                            </div>
                            <p className="reserva-ayuda">
                              Total {formattedPrice}
                              {mercadoPagoEnabled
                                ? null
                                : ' · Mercado Pago se habilita cuando el salón configura la cuenta.'}
                            </p>
                          </div>
                        ) : null}
                        <strong className="reserva-paso">
                          {showModuleStep
                            ? showPaymentStep ? '7. Tus datos' : '6. Tus datos'
                            : showPaymentStep ? '6. Tus datos' : '5. Tus datos'}
                        </strong>
                        <div className="reserva-campos">
                          <label>Nombre<input name="name" required autoComplete="name" /></label>
                          <label>Teléfono<input name="phone" required autoComplete="tel" /></label>
                        </div>
                        <label>Email<input name="email" type="email" required autoComplete="email" /></label>
                        <label>Comentario (opcional)<input name="notes" placeholder="Ej.: llego 5 min tarde" /></label>
                        {error ? <p className="error">{error}</p> : null}
                        <button
                          className="primary"
                          type="submit"
                          disabled={submitting || success || (showPaymentStep && !paymentMethod)}
                        >
                          {submitting
                            ? paymentMethod === 'mercadopago'
                              ? 'Redirigiendo a Mercado Pago…'
                              : 'Confirmando…'
                            : paymentMethod === 'mercadopago'
                              ? `Pagar ${formattedPrice} con Mercado Pago`
                              : `Confirmar ${selectedService?.name} · ${timeFormatter.format(new Date(selectedSlot.startsAt))}`}
                        </button>
                      </form>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}

            {!moduleKey && data.modules.length === 0 ? (
              <div className="vacio-situacion">
                <h2>Sin servicios disponibles</h2>
                <p>Esta peluquería todavía no tiene rubros activos para reservar online.</p>
              </div>
            ) : null}
      </section>

      <footer className="reserva-footer">
        <span>Reservas gestionadas con Turno Salón</span>
      </footer>
    </main>
  )
}
