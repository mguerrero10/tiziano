import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { apiGet, apiPatch } from '../lib/api'
import { BOOKING_MODULES, MODULE_LABELS } from '../lib/modules'

type PriceUpdateDirection = 'increase' | 'decrease'

type Service = {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  price: number
  active: boolean
  moduleKey: string
}

function formatPrice(value: number) {
  return value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })
}

export function ServicesPage() {
  const { session, me } = useAuth()
  const [services, setServices] = useState<Service[]>([])
  const [error, setError] = useState<string | null>(null)
  const [activeModule, setActiveModule] = useState<string>('all')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null)
  const [priceDraft, setPriceDraft] = useState('')
  const [priceUpdateOpen, setPriceUpdateOpen] = useState(false)
  const [priceUpdateDirection, setPriceUpdateDirection] = useState<PriceUpdateDirection>('increase')
  const [priceUpdatePercentage, setPriceUpdatePercentage] = useState('')
  const [updatingPrices, setUpdatingPrices] = useState(false)

  const enabledBookingModules = useMemo(
    () => BOOKING_MODULES.filter((key) => me?.enabledModules.includes(key)),
    [me?.enabledModules],
  )

  useEffect(() => {
    if (!session) return
    apiGet<Service[]>('/api/services', session.access_token)
      .then(setServices)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los servicios.')
      })
  }, [session])

  async function patchService(id: string, body: { active?: boolean; price?: number }) {
    if (!session) return
    setSavingId(id)
    setError(null)
    try {
      const updated = await apiPatch<Service>(`/api/services/${id}`, session.access_token, body)
      setServices((current) => current.map((service) => (service.id === id ? updated : service)))
      setEditingPriceId(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar el servicio.')
    } finally {
      setSavingId(null)
    }
  }

  async function toggleActive(service: Service) {
    await patchService(service.id, { active: !service.active })
  }

  function startEditPrice(service: Service) {
    setEditingPriceId(service.id)
    setPriceDraft(String(service.price))
    setError(null)
  }

  function cancelEditPrice() {
    setEditingPriceId(null)
    setPriceDraft('')
  }

  async function savePrice(service: Service) {
    const price = Number(priceDraft.trim().replace(',', '.'))
    if (!Number.isFinite(price) || price < 0) {
      setError('Ingresá un precio válido.')
      return
    }
    if (price === service.price) {
      cancelEditPrice()
      return
    }
    await patchService(service.id, { price })
  }

  function openPriceUpdate() {
    setPriceUpdateOpen(true)
    setPriceUpdateDirection('increase')
    setPriceUpdatePercentage('')
    setError(null)
  }

  function closePriceUpdate() {
    if (updatingPrices) return
    setPriceUpdateOpen(false)
    setPriceUpdateDirection('increase')
    setPriceUpdatePercentage('')
  }

  async function applyPriceUpdate() {
    if (!session) return

    const percentage = Number(priceUpdatePercentage.trim().replace(',', '.'))
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 1000) {
      setError('Ingresá un porcentaje válido.')
      return
    }
    if (services.length === 0) {
      setError('No hay servicios para actualizar.')
      return
    }

    setUpdatingPrices(true)
    setError(null)
    try {
      const multiplier = priceUpdateDirection === 'increase'
        ? 1 + percentage / 100
        : 1 - percentage / 100
      const updatedServices = await Promise.all(
        services.map(async (service) => {
          const price = Math.round(service.price * multiplier * 100) / 100
          return apiPatch<Service>(`/api/services/${service.id}`, session.access_token, { price })
        }),
      )

      setServices(updatedServices)
      setEditingPriceId(null)
      setPriceUpdateOpen(false)
      setPriceUpdateDirection('increase')
      setPriceUpdatePercentage('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron actualizar los precios.')
    } finally {
      setUpdatingPrices(false)
    }
  }

  const visibleServices = activeModule === 'all'
    ? services
    : services.filter((service) => service.moduleKey === activeModule)

  return (
    <div className="panel">
      <section className="header-panel">
        <div>
          <span className="antetitulo">Catálogo</span>
          <h1>Servicios</h1>
        </div>
        <button
          type="button"
          className="primary"
          disabled={!session || updatingPrices}
          onClick={openPriceUpdate}
        >
          Actualizar precios
        </button>
      </section>

      {enabledBookingModules.length > 1 ? (
        <div className="modulo-pestanas" role="tablist" aria-label="Filtrar por módulo">
          <button
            type="button"
            role="tab"
            aria-selected={activeModule === 'all'}
            className={`modulo-pestana${activeModule === 'all' ? ' esta-activo' : ''}`}
            onClick={() => setActiveModule('all')}
          >
            Todos
          </button>
          {enabledBookingModules.map((moduleKey) => (
            <button
              type="button"
              role="tab"
              key={moduleKey}
              aria-selected={activeModule === moduleKey}
              className={`modulo-pestana${activeModule === moduleKey ? ' esta-activo' : ''}`}
              onClick={() => setActiveModule(moduleKey)}
            >
              {MODULE_LABELS[moduleKey]}
            </button>
          ))}
        </div>
      ) : null}

      <section className="tarjeta-panel">
        {error ? <p className="error">{error}</p> : null}
        <div className="servicio-grid">
          {visibleServices.map((service) => {
            const isEditing = editingPriceId === service.id
            const isSaving = savingId === service.id

            return (
              <article
                className={`servicio-tarjeta${service.active ? '' : ' servicio-tarjeta-inactivo'}`}
                key={service.id}
              >
                <div>
                  <div className="servicio-tarjeta-datos">
                    <span className="modulo-etiqueta">{MODULE_LABELS[service.moduleKey] ?? service.moduleKey}</span>
                    <span className={`estado ${service.active ? 'estado-confirmado' : 'estado-cancelado'}`}>
                      {service.active ? 'Activo en reservas' : 'Sin reservas online'}
                    </span>
                  </div>
                  <h2>{service.name}</h2>
                  <p>{service.description || 'Sin descripción'}</p>
                </div>

                <footer className="servicio-tarjeta-footer">
                  <div className="servicio-tarjeta-resumen">
                    <span>{service.durationMinutes} min</span>
                    <strong>{formatPrice(service.price)}</strong>
                  </div>

                  {isEditing ? (
                    <div className="servicio-tarjeta-editar">
                      <label>
                        Nuevo precio
                        <input
                          type="number"
                          min="0"
                          step="100"
                          value={priceDraft}
                          disabled={isSaving}
                          autoFocus
                          onChange={(event) => setPriceDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void savePrice(service)
                            }
                            if (event.key === 'Escape') cancelEditPrice()
                          }}
                        />
                      </label>
                      <div className="servicio-tarjeta-acciones">
                        <button type="button" className="primary" disabled={isSaving} onClick={() => savePrice(service)}>
                          Guardar
                        </button>
                        <button type="button" className="secundario" disabled={isSaving} onClick={cancelEditPrice}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="servicio-tarjeta-acciones">
                      <button
                        type="button"
                        className="secundario"
                        disabled={isSaving}
                        onClick={() => startEditPrice(service)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className={`secundario servicio-tarjeta-interruptor${service.active ? ' esta-desactivado' : ' esta-activado'}`}
                        disabled={isSaving}
                        onClick={() => toggleActive(service)}
                      >
                        {service.active ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  )}
                </footer>

                {!service.active ? (
                  <p className="servicio-tarjeta-ayuda">No aparece en el portal público mientras esté desactivado.</p>
                ) : null}
              </article>
            )
          })}
        </div>
        {!error && visibleServices.length === 0 ? (
          <div className="vacio-situacion">
            <h2>No hay servicios en este módulo</h2>
          </div>
        ) : null}
      </section>

      {priceUpdateOpen ? (
        <div className="modal-fondo" role="presentation" onClick={closePriceUpdate}>
          <div
            className="modal-tarjeta modal-tarjeta-form"
            role="dialog"
            aria-modal="true"
            aria-labelledby="price-update-title"
            onClick={(event) => event.stopPropagation()}
          >
            <form
              className="modal-form"
              onSubmit={(event) => {
                event.preventDefault()
                void applyPriceUpdate()
              }}
            >
              <h2 id="price-update-title">Actualizar precios</h2>
              <p className="modal-tarjeta-subheader">
                Aplicá un porcentaje a todos los servicios del catálogo.
              </p>

              <label>
                Acción
                <select
                  value={priceUpdateDirection}
                  disabled={updatingPrices}
                  onChange={(event) => setPriceUpdateDirection(event.target.value as PriceUpdateDirection)}
                >
                  <option value="increase">Aumentar</option>
                  <option value="decrease">Disminuir</option>
                </select>
              </label>

              <label>
                Porcentaje
                <input
                  type="number"
                  min="0"
                  max="1000"
                  step="0.1"
                  value={priceUpdatePercentage}
                  disabled={updatingPrices}
                  autoFocus
                  onChange={(event) => setPriceUpdatePercentage(event.target.value)}
                />
              </label>

              <p className="atenuado">Se actualizarán {services.length} servicios.</p>

              <div className="modal-form-acciones">
                <button type="button" className="secundario" disabled={updatingPrices} onClick={closePriceUpdate}>
                  Cancelar
                </button>
                <button type="submit" className="primary" disabled={updatingPrices}>
                  {updatingPrices ? 'Actualizando...' : 'Aplicar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
