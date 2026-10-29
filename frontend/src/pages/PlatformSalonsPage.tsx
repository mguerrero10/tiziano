import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { apiGet, apiPatch, apiPost } from '../lib/api'
import { uploadSalonLogo } from '../lib/salonLogo'

type ModuleCatalogItem = {
  key: string
  name: string
  description: string
}

type SalonModule = {
  key: string
  enabled: boolean
}

type PlatformClient = {
  id: string
  name: string
  slug: string
  phone: string | null
  address: string | null
  active: boolean
  logoUrl: string | null
  ownerName: string | null
  ownerEmail: string | null
  customerCount: number
  upcomingCount: number
  modules: SalonModule[]
}

function slugFromName(name: string) {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function PlatformSalonsPage() {
  const { session } = useAuth()
  const [catalog, setCatalog] = useState<ModuleCatalogItem[]>([])
  const [clients, setClients] = useState<PlatformClient[]>([])
  const [error, setError] = useState<string | null>(null)
  const [successOpen, setSuccessOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [slugTouched, setSlugTouched] = useState(false)
  const [passwordClient, setPasswordClient] = useState<PlatformClient | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccessOpen, setPasswordSuccessOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    if (!session) return
    try {
      const [modules, rows] = await Promise.all([
        apiGet<ModuleCatalogItem[]>('/api/platform/modules', session.access_token),
        apiGet<PlatformClient[]>('/api/platform/salons', session.access_token),
      ])
      setCatalog(modules)
      setClients(rows)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los clientes.')
    }
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null)
      return
    }
    const url = URL.createObjectURL(logoFile)
    setLogoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [logoFile])

  function resetCreateForm() {
    setName('')
    setSlug('')
    setOwnerEmail('')
    setOwnerName('')
    setOwnerPassword('')
    setPhone('')
    setAddress('')
    setLogoFile(null)
    setSlugTouched(false)
  }

  function closeCreateModal() {
    setCreateOpen(false)
    resetCreateForm()
  }

  function openCreateModal() {
    setError(null)
    setCreateOpen(true)
  }

  function openPasswordModal(client: PlatformClient) {
    setPasswordClient(client)
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError(null)
  }

  function closePasswordModal() {
    setPasswordClient(null)
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError(null)
  }

  async function createClient(event: FormEvent) {
    event.preventDefault()
    if (!session) return
    setSubmitting(true)
    setSuccessOpen(false)
    setError(null)
    try {
      const created = await apiPost<{ id: string }>(
        '/api/platform/salons',
        session.access_token,
        {
          name,
          slug,
          ownerEmail,
          ownerPassword,
          ownerName: ownerName || null,
          phone,
          address,
        },
      )

      if (logoFile) {
        const logoUrl = await uploadSalonLogo(created.id, logoFile)
        await apiPatch(`/api/platform/salons/${created.id}`, session.access_token, { logoUrl })
      }

      resetCreateForm()
      setCreateOpen(false)
      setSuccessOpen(true)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo crear el cliente.')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitPasswordReset(event: FormEvent) {
    event.preventDefault()
    if (!session || !passwordClient) return

    if (newPassword.length < 6) {
      setPasswordError('La contraseña debe tener al menos 6 caracteres.')
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Las contraseñas no coinciden.')
      return
    }

    setPasswordSubmitting(true)
    setPasswordError(null)
    try {
      await apiPost(
        `/api/platform/salons/${passwordClient.id}/owner/password`,
        session.access_token,
        { password: newPassword },
      )
      closePasswordModal()
      setPasswordSuccessOpen(true)
    } catch (reason) {
      setPasswordError(reason instanceof Error ? reason.message : 'No se pudo restablecer la clave.')
    } finally {
      setPasswordSubmitting(false)
    }
  }

  async function toggleActive(client: PlatformClient) {
    if (!session) return
    try {
      await apiPatch(`/api/platform/salons/${client.id}`, session.access_token, {
        active: !client.active,
      })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar el cliente.')
    }
  }

  async function toggleModule(client: PlatformClient, moduleKey: string, enabled: boolean) {
    if (!session) return
    try {
      await apiPatch(
        `/api/platform/salons/${client.id}/modules/${moduleKey}`,
        session.access_token,
        { enabled },
      )
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar el módulo.')
    }
  }

  function isModuleEnabled(client: PlatformClient, moduleKey: string) {
    return client.modules.find((module) => module.key === moduleKey)?.enabled ?? false
  }

  return (
    <div className="panel">
      <section className="header-panel">
        <div>
          <span className="antetitulo">Plataforma</span>
          <h1>Clientes</h1>
          <p>
            Peluquerias que alquilan Turno Salon. Activa los módulos que contrataron.
            {' '}
          </p>
        </div>
        <button type="button" className="primary" onClick={openCreateModal}>
          Nuevo Cliente
        </button>
      </section>

      {error ? <p className="error">{error}</p> : null}

      {successOpen ? (
        <div className="modal-fondo" role="presentation" onClick={() => setSuccessOpen(false)}>
          <div
            className="modal-tarjeta"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-success-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="client-success-title">Cliente dado de alta exitosamente</h2>
            <button type="button" className="primary" onClick={() => setSuccessOpen(false)}>
              Aceptar
            </button>
          </div>
        </div>
      ) : null}

      {passwordSuccessOpen ? (
        <div className="modal-fondo" role="presentation" onClick={() => setPasswordSuccessOpen(false)}>
          <div
            className="modal-tarjeta"
            role="dialog"
            aria-modal="true"
            aria-labelledby="password-success-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="password-success-title">Contraseña restablecida</h2>
            <button type="button" className="primary" onClick={() => setPasswordSuccessOpen(false)}>
              Aceptar
            </button>
          </div>
        </div>
      ) : null}

      {passwordClient ? (
        <div className="modal-fondo" role="presentation" onClick={closePasswordModal}>
          <div
            className="modal-tarjeta modal-tarjeta-form"
            role="dialog"
            aria-modal="true"
            aria-labelledby="password-reset-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="password-reset-title">Restablecer clave</h2>
            <p className="modal-tarjeta-subheader">{passwordClient.name}</p>
            <form className="modal-form" onSubmit={submitPasswordReset}>
              <label>
                Nueva contraseña
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  minLength={6}
                  required
                />
              </label>
              <label>
                Confirmar contraseña
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={6}
                  required
                />
              </label>
              {passwordError ? <p className="error">{passwordError}</p> : null}
              <div className="modal-form-acciones">
                <button type="button" className="secundario" onClick={closePasswordModal}>
                  Cancelar
                </button>
                <button type="submit" className="primary" disabled={passwordSubmitting}>
                  {passwordSubmitting ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className="modal-fondo" role="presentation" onClick={closeCreateModal}>
          <div
            className="modal-tarjeta modal-tarjeta-form modal-tarjeta-amplio"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-client-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="create-client-title">Nuevo cliente</h2>
            <form className="plataforma-form" onSubmit={createClient}>
              <label>
                Nombre comercial
                <input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)
                    if (!slugTouched) setSlug(slugFromName(event.target.value))
                  }}
                  placeholder="Salón Tiziano"
                  maxLength={80}
                  required
                />
              </label>
              <label>
                URL pública
                <input
                  value={slug}
                  onChange={(event) => {
                    setSlugTouched(true)
                    setSlug(event.target.value.toLowerCase())
                  }}
                  placeholder="salon-tiziano"
                  required
                />
              </label>
              <label>
                Email del titular
                <input
                  type="email"
                  value={ownerEmail}
                  onChange={(event) => setOwnerEmail(event.target.value)}
                  required
                />
              </label>
              <label>
                Nombre del titular
                <input
                  value={ownerName}
                  onChange={(event) => setOwnerName(event.target.value)}
                  placeholder="Opcional"
                />
              </label>
              <label>
                Contraseña inicial
                <input
                  type="password"
                  value={ownerPassword}
                  onChange={(event) => setOwnerPassword(event.target.value)}
                  minLength={6}
                  required
                />
              </label>
              <label className="plataforma-form-amplio logotipo-carga">
                Logo
                <div className="logotipo-carga-fila">
                  {logoPreview ? (
                    <img className="logotipo-carga-vista-previa" src={logoPreview} alt="Vista previa del logo" />
                  ) : (
                    <span className="logotipo-carga-marcador">Sin logo</span>
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)}
                  />
                </div>
              </label>
              <label>
                Teléfono
                <input value={phone} onChange={(event) => setPhone(event.target.value)} />
              </label>
              <label className="plataforma-form-amplio">
                Dirección
                <input value={address} onChange={(event) => setAddress(event.target.value)} />
              </label>
              <div className="modal-form-acciones plataforma-form-amplio">
                <button type="button" className="secundario" onClick={closeCreateModal}>
                  Cancelar
                </button>
                <button type="submit" className="primary" disabled={submitting}>
                  {submitting ? 'Creando…' : 'Dar de alta cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <section className="tarjeta-panel tabla-tarjeta">
        <div className="tarjeta-panel-header">
          <div>
            <h2>Peluquerías clientes</h2>
            <p>{clients.length} en la plataforma</p>
          </div>
        </div>

        {clients.length ? (
          <div className="cliente-lista">
            {clients.map((client) => (
              <article className="cliente-tarjeta" key={client.id}>
                <header className="cliente-tarjeta-header">
                  <div className="cliente-tarjeta-titulo">
                    {client.logoUrl ? (
                      <img className="cliente-tarjeta-logotipo" src={client.logoUrl} alt="" />
                    ) : (
                      <span className="cliente-tarjeta-logotipo cliente-tarjeta-logotipo-vacio">
                        {client.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div>
                      <strong>{client.name}</strong>
                      <small>
                        <a href={`/s/${client.slug}`} target="_blank" rel="noreferrer">
                          /s/{client.slug}
                        </a>
                      </small>
                    </div>
                  </div>
                  <span className="plataforma-acciones">
                    <button type="button" className="secundario" onClick={() => openPasswordModal(client)}>
                      Restablecer clave
                    </button>
                    <span className={`estado ${client.active ? 'estado-confirmado' : 'estado-cancelado'}`}>
                      {client.active ? 'Activo' : 'Pausado'}
                    </span>
                    <button type="button" className="secundario" onClick={() => toggleActive(client)}>
                      {client.active ? 'Pausar' : 'Activar'}
                    </button>
                  </span>
                </header>

                <div className="cliente-tarjeta-datos">
                  <span>
                    Titular: {client.ownerName || '—'}
                    <small>{client.ownerEmail || 'Sin titular'}</small>
                  </span>
                  <span>
                    {client.upcomingCount} turnos · {client.customerCount} personas atendidas
                  </span>
                </div>

                <div className="modulo-interruptores">
                  <span className="modulo-interruptores-rotulo">Módulos contratados</span>
                  <div className="modulo-interruptores-grid">
                    {catalog.map((module) => {
                      const enabled = isModuleEnabled(client, module.key)
                      return (
                        <button
                          type="button"
                          key={module.key}
                          className={`modulo-interruptor${enabled ? ' esta-activado' : ''}`}
                          title={module.description}
                          onClick={() => toggleModule(client, module.key, !enabled)}
                        >
                          <span>{module.name}</span>
                          <small>{enabled ? 'Activo' : 'Off'}</small>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="vacio-situacion">
            <h2>Sin clientes registrados</h2>
          </div>
        )}
      </section>
    </div>
  )
}
