import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { apiGet, apiPatch, apiPost } from '../lib/api'

type StaffMember = {
  id: string
  displayName: string
  active: boolean
  email: string | null
  serviceNames: string
}

type ServiceOption = {
  id: string
  name: string
  active: boolean
}

export function StaffPage() {
  const { session } = useAuth()
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [services, setServices] = useState<ServiceOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])

  const activeServices = services.filter((service) => service.active)

  useEffect(() => {
    if (!session) return
    setLoading(true)
    Promise.all([
      apiGet<StaffMember[]>('/api/staff', session.access_token),
      apiGet<ServiceOption[]>('/api/services', session.access_token),
    ])
      .then(([staffRows, serviceRows]) => {
        setStaff(staffRows)
        setServices(serviceRows)
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'No se pudo cargar el personal.')
      })
      .finally(() => setLoading(false))
  }, [session])

  function openCreate() {
    setDisplayName('')
    setSelectedServiceIds(activeServices.map((service) => service.id))
    setError(null)
    setMessage(null)
    setModalOpen(true)
  }

  function closeModal() {
    if (saving) return
    setModalOpen(false)
    setDisplayName('')
    setSelectedServiceIds([])
  }

  function toggleService(serviceId: string) {
    setSelectedServiceIds((current) =>
      current.includes(serviceId)
        ? current.filter((id) => id !== serviceId)
        : [...current, serviceId],
    )
  }

  async function saveStaff(event: FormEvent) {
    event.preventDefault()
    if (!session) return

    const name = displayName.trim()
    if (!name) {
      setError('Indicá el nombre del profesional.')
      return
    }
    if (activeServices.length > 0 && selectedServiceIds.length === 0) {
      setError('Elegí al menos un servicio.')
      return
    }

    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const created = await apiPost<StaffMember>('/api/staff', session.access_token, {
        displayName: name,
        serviceIds: selectedServiceIds,
      })
      setStaff((current) =>
        [...current, created].sort((a, b) => a.displayName.localeCompare(b.displayName, 'es')),
      )
      setMessage('Profesional agregado.')
      setModalOpen(false)
      setDisplayName('')
      setSelectedServiceIds([])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo agregar el profesional.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(person: StaffMember) {
    if (!session) return
    setTogglingId(person.id)
    setError(null)
    setMessage(null)
    try {
      const updated = await apiPatch<StaffMember>(`/api/staff/${person.id}`, session.access_token, {
        active: !person.active,
      })
      setStaff((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setMessage(updated.active ? 'Profesional activado.' : 'Profesional desactivado.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar el profesional.')
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div className="panel">
      <section className="header-panel">
        <div>
          <span className="antetitulo">Equipo del salón</span>
          <h1>Profesionales</h1>
        </div>
        <button type="button" className="primary primary-solid" disabled={!session || loading} onClick={openCreate}>
          Nuevo profesional
        </button>
      </section>

      <section className="tarjeta-panel tabla-tarjeta">
        {error && !modalOpen ? <p className="error">{error}</p> : null}
        {message ? <p className="correcto">{message}</p> : null}
        {loading ? null : staff.length ? (
          <div className="datos-tabla profesionales-tabla">
            <div className="datos-tabla-cabecera">
              <span>Profesional</span>
              <span>Cuenta</span>
              <span>Servicios</span>
              <span>Estado</span>
              <span>Acciones</span>
            </div>
            {staff.map((person) => (
              <article
                className={`datos-tabla-fila${person.active ? '' : ' datos-tabla-fila-inactivo'}`}
                key={person.id}
              >
                <strong>{person.displayName}</strong>
                <span>{person.email ?? 'Sin usuario vinculado'}</span>
                <span>{person.serviceNames || 'Sin servicios asignados'}</span>
                <span>
                  <span className={`estado ${person.active ? 'estado-confirmado' : 'estado-inactivo'}`}>
                    {person.active ? 'Activo' : 'Inactivo'}
                  </span>
                </span>
                <span>
                  <button
                    type="button"
                    className="secundario"
                    disabled={togglingId === person.id}
                    onClick={() => void toggleActive(person)}
                  >
                    {togglingId === person.id ? 'Guardando…' : person.active ? 'Desactivar' : 'Activar'}
                  </button>
                </span>
              </article>
            ))}
          </div>
        ) : !error ? (

        //TO DO mejorar vista sin empleados registrados, agregarle show

          <div className="vacio-situacion">
            <h2>Sin profesionales registrados</h2>
          </div>
        ) : null}
      </section>

      {modalOpen ? (
        <div className="modal-fondo" role="presentation" onClick={closeModal}>
          <div
            className="modal-tarjeta modal-tarjeta-form modal-tarjeta-profesionales"
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-form-title"
            onClick={(event) => event.stopPropagation()}
          >
            <form className="modal-form" onSubmit={(event) => void saveStaff(event)}>
              <h2 id="staff-form-title">Nuevo profesional</h2>
              <label>
                Nombre
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={displayName}
                  disabled={saving}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>

              <div className="servicio-seleccion-campo">
                <span>Servicios que atiende</span>
                {activeServices.length ? (
                  <div className="servicio-seleccion">
                    {activeServices.map((service) => (
                      <label key={service.id}>
                        <input
                          type="checkbox"
                          checked={selectedServiceIds.includes(service.id)}
                          disabled={saving}
                          onChange={() => toggleService(service.id)}
                        />
                        {service.name}
                      </label>
                    ))}
                  </div>
                ) : (
                  <small>Sin servicios activos.</small>
                )}
                {activeServices.length ? (
                  <small>Servicios habilitados para reservas con este profesional.</small>
                ) : null}
              </div>

              {error ? <p className="error">{error}</p> : null}

              <div className="modal-form-acciones">
                <button type="submit" className="primary primary-solid" disabled={saving}>
                  {saving ? 'Guardando…' : 'Agregar'}
                </button>
                <button type="button" className="secundario" disabled={saving} onClick={closeModal}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
