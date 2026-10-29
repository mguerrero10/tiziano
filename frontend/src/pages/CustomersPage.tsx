import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { apiGet } from '../lib/api'

type Customer = {
  id: string
  name: string
  phone: string
  email: string | null
  appointmentCount: number
  lastAppointmentAt: string | null
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export function CustomersPage() {
  const { session } = useAuth()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!session) return
    apiGet<Customer[]>('/api/customers', session.access_token)
      .then(setCustomers)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los clientes.')
      })
  }, [session])

  const visibleCustomers = useMemo(() => {
    const normalizedQuery = normalize(query.trim())
    if (!normalizedQuery) return customers

    const digits = normalizedQuery.replace(/\D/g, '')
    return customers.filter((customer) => {
      const name = normalize(customer.name)
      const email = normalize(customer.email ?? '')
      const phone = customer.phone.toLowerCase()
      const phoneDigits = customer.phone.replace(/\D/g, '')
      return (
        name.includes(normalizedQuery)
        || email.includes(normalizedQuery)
        || phone.includes(normalizedQuery)
        || (digits.length > 0 && phoneDigits.includes(digits))
      )
    })
  }, [customers, query])

  return (
    <div className="panel">
      <section className="header-panel">
        <div>
          <span className="antetitulo">Base del salón</span>
          <h1>Clientes</h1>
          {customers.length > 0 ? (
            <p>{customers.length} {customers.length === 1 ? 'cliente registrado' : 'clientes registrados'}</p>
          ) : null}
        </div>
        {customers.length ? (
          <label className="lista-busqueda">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              placeholder="Buscar por nombre, teléfono o email"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Buscar clientes"
            />
          </label>
        ) : null}
      </section>

      <section className="tarjeta-panel tabla-tarjeta">
        {error ? <p className="error">{error}</p> : null}
        {visibleCustomers.length ? (
          <div className="datos-tabla">
            <div className="datos-tabla-cabecera">
              <span>Cliente</span>
              <span>Contacto</span>
              <span>Turnos</span>
              <span>Última visita</span>
            </div>
            {visibleCustomers.map((customer) => (
              <article className="datos-tabla-fila" key={customer.id}>
                <strong>{customer.name}</strong>
                <span>{customer.phone}<small>{customer.email}</small></span>
                <span>{customer.appointmentCount}</span>
                <span>
                  {customer.lastAppointmentAt
                    ? new Date(customer.lastAppointmentAt).toLocaleDateString('es-AR')
                    : '—'}
                </span>
              </article>
            ))}
          </div>
        ) : !error && customers.length === 0 ? (
          <div className="vacio-situacion">
            <h2>Sin clientes registrados</h2>
          </div>
        ) : !error ? (
          <div className="vacio-situacion">
            <h2>Sin resultados</h2>
            <p>Ningun cliente coincide con “{query.trim()}”.</p>
          </div>
        ) : null}
      </section>
    </div>
  )
}
