import { useEffect, useState, type ChangeEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { apiPatch } from '../lib/api'
import { uploadSalonLogo } from '../lib/salonLogo'
import { hasModule } from '../lib/modules'

export function SettingsPage() {
  const { session, me, refreshMe } = useAuth()
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [storeEnabled, setStoreEnabled] = useState(false)
  const [storeSaving, setStoreSaving] = useState(false)

  const showStoreSettings = hasModule(me?.enabledModules, 'products')
  const currentLogo = me?.salon?.logoUrl ?? null
  const preview = logoPreview ?? currentLogo

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null)
      return
    }

    const url = URL.createObjectURL(logoFile)
    setLogoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [logoFile])

  useEffect(() => {
    setStoreEnabled(me?.salon?.storeEnabled ?? false)
  }, [me?.salon?.storeEnabled])

  async function saveStoreEnabled(next: boolean) {
    if (!session) return
    setStoreSaving(true)
    setError(null)
    setMessage(null)
    try {
      await apiPatch('/api/salon/store', session.access_token, { storeEnabled: next })
      setStoreEnabled(next)
      await refreshMe()
      setMessage(
        next
          ? 'Tienda visible para clientes en la web de reservas.'
          : 'Tienda oculta. Los clientes ya no ven el boton ni el catálogo.',
      )
    } catch (reason) {
      setStoreEnabled(me?.salon?.storeEnabled ?? false)
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar la tienda.')
    } finally {
      setStoreSaving(false)
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setLogoFile(file)
    setError(null)
    setMessage(null)
  }

  async function saveLogo() {
    if (!session || !me?.salon || !logoFile) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const logoUrl = await uploadSalonLogo(me.salon.id, logoFile)
      await apiPatch('/api/salon/logo', session.access_token, { logoUrl })
      await refreshMe()
      setLogoFile(null)
      setFileInputKey((value) => value + 1)
      setMessage('Logo actualizado. Ya se ve en el panel y en la web de reservas.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar el logo.')
    } finally {
      setSaving(false)
    }
  }

  async function removeLogo() {
    if (!session || !currentLogo) return
    setRemoving(true)
    setError(null)
    setMessage(null)
    try {
      await apiPatch('/api/salon/logo', session.access_token, { logoUrl: '' })
      await refreshMe()
      setLogoFile(null)
      setFileInputKey((value) => value + 1)
      setMessage('Logo quitado. El panel y la web de reservas vuelven a la marca por defecto.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo quitar el logo.')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="panel">
      <section className="header-panel">
        <div>
          <span className="antetitulo">Salón</span>
          <h1>Ajustes</h1>
          <p>Logo del salón y visibilidad de la tienda en la web de reservas.</p>
        </div>
      </section>

      {!me?.hasSalon ? (
        <section className="tarjeta-panel vacio-situacion">
          <p>Tu usuario no pertenece a una peluquería.</p>
        </section>
      ) : (
        <section className="tarjeta-panel ajustes-logotipo">
          <h2>Logo del salón</h2>
          <p>PNG, JPG, WEBP o GIF. Máximo 2 MB.</p>

          <div className="ajustes-logotipo-fila">
            {preview ? (
              <img className="ajustes-logotipo-vista-previa" src={preview} alt="Logo del salón" />
            ) : (
              <span className="ajustes-logotipo-marcador" aria-hidden="true">
                {(me.salon?.name ?? 'S').trim().charAt(0).toUpperCase() || 'S'}
              </span>
            )}
            <label className="ajustes-logotipo-archivo">
              Elegir imagen
              <input
                key={fileInputKey}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={onFileChange}
              />
            </label>
          </div>

          {error ? <p className="error">{error}</p> : null}
          {message ? <p className="correcto">{message}</p> : null}

          <div className="ajustes-logotipo-acciones">
            <button type="button" className="primary" disabled={!logoFile || saving || removing} onClick={() => void saveLogo()}>
              {saving ? 'Guardando…' : 'Guardar logo'}
            </button>
            {currentLogo ? (
              <button type="button" className="secundario" disabled={saving || removing} onClick={() => void removeLogo()}>
                {removing ? 'Quitando…' : 'Quitar logo'}
              </button>
            ) : null}
          </div>
        </section>
      )}

      {me?.hasSalon && showStoreSettings ? (
        <section className="tarjeta-panel ajustes-tienda">
          <h2>Tienda online</h2>
          <p>
            Cuando está activa, tus clientes ven el botón <strong>Tienda</strong> en{' '}
            {me.salon?.slug ? (
              <a href={`/s/${me.salon.slug}/tienda`} target="_blank" rel="noreferrer">
                /s/{me.salon.slug}/tienda
              </a>
            ) : (
              'la web de reservas'
            )}
            .
          </p>
          <label className="ajustes-interruptor ajustes-interruptor-fila">
            <span>
              <strong>Mostrar tienda a clientes</strong>
              <small>{storeEnabled ? 'Visible en la web pública' : 'Oculta: no aparece el botón Tienda'}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={storeEnabled}
              disabled={storeSaving}
              onChange={(event) => void saveStoreEnabled(event.target.checked)}
            />
          </label>
        </section>
      ) : null}
    </div>
  )
}
