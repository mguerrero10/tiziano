import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ShoppingCart } from 'lucide-react'
import mercadoPagoLogo from '../assets/images/mercadopago-logo.png'
import { Brand } from '../components/Brand'
import { apiGetPublic, apiPostPublic } from '../lib/api'
import {
  closeMercadoPagoCheckout,
  openMercadoPagoCheckout,
  tryCloseMercadoPagoReturnTab,
} from '../lib/mercadopagoWindow'

type StoreProduct = {
  id: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  category: string | null
  brand: string | null
  sizeMl: number | null
  inStock: boolean
}

type SortBy = 'relevance' | 'price-asc' | 'price-desc' | 'name'

const sortOptions: { value: SortBy; label: string }[] = [
  { value: 'relevance', label: 'Más relevantes' },
  { value: 'price-asc', label: 'Menor precio' },
  { value: 'price-desc', label: 'Mayor precio' },
  { value: 'name', label: 'Nombre (A-Z)' },
]

const sizeRanges = [
  { label: 'Hasta 250 ml', min: '', max: '250' },
  { label: '250 a 500 ml', min: '250', max: '500' },
  { label: '500 a 1000 ml', min: '500', max: '1000' },
  { label: 'Más de 1000 ml', min: '1000', max: '' },
]

type StoreData = {
  salon: {
    name: string
    logoUrl: string | null
  }
  products: StoreProduct[]
  payments?: {
    mercadoPago: boolean
    testMode?: boolean
  }
}

type CreatedOrder = {
  id: string
  productName: string
  paymentStatus: string
  status: string
  amount: number
  checkoutUrl?: string | null
  items: OrderItem[]
}

type OrderItem = {
  productId: string
  productName: string
  quantity: number
  unitPrice: number
}

type OrderPayment = {
  id: string
  productName: string
  paymentStatus: string
  status: string
  amount: number
  items: OrderItem[]
}

function formatPrice(value: number) {
  return value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })
}

export function StorePage() {
  const { slug } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const paymentReturnHandled = useRef(false)
  const mpWindowRef = useRef<Window | null>(null)

  const [data, setData] = useState<StoreData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [cart, setCart] = useState<{ productId: string; quantity: number }[]>([])
  const [checkoutItems, setCheckoutItems] = useState<{ productId: string; quantity: number }[] | null>(null)
  const [cartLoadedFor, setCartLoadedFor] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<'salon' | 'mercadopago'>('salon')
  const [submitting, setSubmitting] = useState(false)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const [orderId, setOrderId] = useState<string | null>(null)
  const [awaitingPayment, setAwaitingPayment] = useState(false)
  const [paidOrder, setPaidOrder] = useState<OrderPayment | null>(null)

  const [activeCategory, setActiveCategory] = useState('')
  const [brandFilter, setBrandFilter] = useState<string[]>([])
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [minSize, setMinSize] = useState('')
  const [maxSize, setMaxSize] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('relevance')
  const [search, setSearch] = useState('')
  const [sortOpen, setSortOpen] = useState(false)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const cartPanelRef = useRef<HTMLElement>(null)
  const cartButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!cartOpen) return
    const panel = cartPanelRef.current
    if (!panel) return
    const cartButton = cartButtonRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCartOpen(false)
      if (event.key !== 'Tab') return
      const controls = Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ))
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
      cartButton?.focus()
    }
  }, [cartOpen])

  useEffect(() => {
    if (!sortOpen) return
    const onClick = (event: MouseEvent) => {
      if (!sortMenuRef.current?.contains(event.target as Node)) setSortOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSortOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [sortOpen])

  const mercadoPagoEnabled = data?.payments?.mercadoPago === true
  const testMode = data?.payments?.testMode === true
  const cartItems = cart.map((item) => ({
    ...item, product: data?.products.find((product) => product.id === item.productId),
  }))
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0)
  const cartTotal = cartItems.reduce((total, item) => total + (item.product?.price ?? 0) * item.quantity, 0)
  const invalidCart = cartItems.some((item) => !item.product?.inStock || item.product.price <= 0)
  const checkoutLines = checkoutItems ?? cart
  const checkoutDetails = checkoutLines.map((item) => ({
    ...item, product: data?.products.find((product) => product.id === item.productId),
  }))
  const checkoutCount = checkoutLines.reduce((total, item) => total + item.quantity, 0)
  const checkoutTotal = checkoutDetails.reduce(
    (total, item) => total + (item.product?.price ?? 0) * item.quantity,
    0,
  )
  const invalidCheckout = checkoutDetails.some(
    (item) => !item.product?.inStock || item.product.price <= 0,
  )

  useEffect(() => {
    if (!slug) return
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(`store-cart:${slug}`) ?? '[]')
      if (!Array.isArray(saved) || !saved.every((item) =>
        typeof item === 'object' && item !== null
        && typeof item.productId === 'string' && Number.isInteger(item.quantity)
        && item.quantity >= 1 && item.quantity <= 99,
      )) throw new Error('El carrito guardado no es válido. Agregá nuevamente tus productos.')
      setCart(saved)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo recuperar el carrito.')
      setCart([])
    }
    setCartLoadedFor(slug)
  }, [slug])

  useEffect(() => {
    if (!slug || cartLoadedFor !== slug) return
    try {
      localStorage.setItem(`store-cart:${slug}`, JSON.stringify(cart))
    } catch {
      setError('No se pudo guardar el carrito en este navegador.')
    }
  }, [cart, cartLoadedFor, slug])

  function changeQuantity(productId: string, quantity: number) {
    if (quantity > 0 && cart.length >= 50 && !cart.some((item) => item.productId === productId)) {
      setError('Podés agregar hasta 50 productos distintos por pedido.')
      return
    }
    setCart((current) => quantity <= 0
      ? current.filter((item) => item.productId !== productId)
      : current.some((item) => item.productId === productId)
        ? current.map((item) => item.productId === productId ? { ...item, quantity: Math.min(99, quantity) } : item)
        : [...current, { productId, quantity: Math.min(99, quantity) }])
  }

  function openCartCheckout() {
    setCheckoutItems(null)
    setCartOpen(false)
    setCheckoutOpen(true)
    setError(null)
  }

  function buyProductNow(productId: string) {
    setCheckoutItems([{ productId, quantity: 1 }])
    setCartOpen(false)
    setCheckoutOpen(true)
    setError(null)
  }

  const categories = useMemo(() => {
    const names = new Set<string>()
    for (const product of data?.products ?? []) {
      if (product.category) names.add(product.category)
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'es'))
  }, [data])

  const brands = useMemo(() => {
    const names = new Set<string>()
    for (const product of data?.products ?? []) {
      if (product.brand) names.add(product.brand)
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'es'))
  }, [data])

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const product of data?.products ?? []) {
      if (product.category) counts.set(product.category, (counts.get(product.category) ?? 0) + 1)
    }
    return counts
  }, [data])

  const priceRanges = useMemo(() => {
    const prices = (data?.products ?? []).map((product) => product.price).filter((value) => value > 0).sort((a, b) => a - b)
    if (prices.length < 2) return []
    const step = (value: number) => Math.max(100, Math.round(value / 1000) * 1000)
    const low = step(prices[Math.floor(prices.length / 3)])
    const high = step(prices[Math.floor((prices.length * 2) / 3)])
    if (low >= high) return []
    return [
      { label: `Hasta ${formatPrice(low)}`, min: '', max: String(low) },
      { label: `${formatPrice(low)} a ${formatPrice(high)}`, min: String(low), max: String(high) },
      { label: `Más de ${formatPrice(high)}`, min: String(high), max: '' },
    ]
  }, [data])

  const hasSizes = (data?.products ?? []).some((product) => product.sizeMl !== null)

  const visibleProducts = useMemo(() => {
    const minP = minPrice === '' ? null : Number(minPrice)
    const maxP = maxPrice === '' ? null : Number(maxPrice)
    const minS = minSize === '' ? null : Number(minSize)
    const maxS = maxSize === '' ? null : Number(maxSize)
    const term = search.trim().toLowerCase()
    const filtered = (data?.products ?? []).filter((product) => {
      if (term && !product.name.toLowerCase().includes(term)) return false
      if (activeCategory && product.category !== activeCategory) return false
      if (brandFilter.length > 0 && (!product.brand || !brandFilter.includes(product.brand))) return false
      if (minP !== null && product.price < minP) return false
      if (maxP !== null && product.price > maxP) return false
      if (minS !== null || maxS !== null) {
        if (product.sizeMl === null) return false
        if (minS !== null && product.sizeMl < minS) return false
        if (maxS !== null && product.sizeMl > maxS) return false
      }
      return true
    })
    if (sortBy === 'price-asc') filtered.sort((a, b) => a.price - b.price)
    else if (sortBy === 'price-desc') filtered.sort((a, b) => b.price - a.price)
    else if (sortBy === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name, 'es'))
    return filtered
  }, [data, activeCategory, brandFilter, minPrice, maxPrice, minSize, maxSize, sortBy, search])

  function toggleBrand(brand: string) {
    setBrandFilter((current) =>
      current.includes(brand) ? current.filter((item) => item !== brand) : [...current, brand],
    )
  }

  const activeChips: { key: string; label: string; clear: () => void }[] = []
  if (activeCategory) activeChips.push({ key: 'cat', label: activeCategory, clear: () => setActiveCategory('') })
  for (const brand of brandFilter) {
    activeChips.push({ key: `brand-${brand}`, label: brand, clear: () => toggleBrand(brand) })
  }
  if (minPrice !== '' || maxPrice !== '') {
    activeChips.push({
      key: 'price',
      label: `$ ${minPrice || '0'} – ${maxPrice || '∞'}`,
      clear: () => {
        setMinPrice('')
        setMaxPrice('')
      },
    })
  }
  if (minSize !== '' || maxSize !== '') {
    activeChips.push({
      key: 'size',
      label: `${minSize || '0'} – ${maxSize || '∞'} ml`,
      clear: () => {
        setMinSize('')
        setMaxSize('')
      },
    })
  }

  function clearFilters() {
    setActiveCategory('')
    setBrandFilter([])
    setMinPrice('')
    setMaxPrice('')
    setMinSize('')
    setMaxSize('')
  }

  useEffect(() => {
    if (!slug) return
    apiGetPublic<StoreData>(`/api/public/salons/${slug}/store`)
      .then(setData)
      .catch((reason: unknown) => {
        setError(reason instanceof Error && reason.message ? reason.message : 'No se pudo cargar la tienda.')
      })
  }, [slug, orderId, paidOrder?.id])

  useEffect(() => {
    const pago = searchParams.get('pago')
    const pedido = searchParams.get('pedido')
    if (!slug || !pago || !pedido || paymentReturnHandled.current) {
      return
    }

    paymentReturnHandled.current = true
    const paymentId = searchParams.get('payment_id') || searchParams.get('collection_id') || ''
    const query = paymentId ? `?paymentId=${encodeURIComponent(paymentId)}` : ''

    //TO DO revisar estos if 

    apiGetPublic<OrderPayment>(`/api/public/salons/${slug}/store/orders/${pedido}${query}`)
      .then((order) => {
        setOrderId(order.id)
        if (order.paymentStatus === 'paid') {
          setPaidOrder(order)
          setCheckoutOpen(false)
          setAwaitingPayment(false)
          setCheckoutUrl(null)
        } else if (order.status === 'cancelled') {
          setAwaitingPayment(false)
          setError('El pago no se completó y el pedido fue cancelado. Podés volver a comprar.')
        } else {
          setAwaitingPayment(true)
        }
        if (order.status !== 'cancelled') setError(null)
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error && reason.message ? reason.message : 'No se pudo verificar el pago.')
      })
      .finally(() => {
        setSearchParams({}, { replace: true })
        tryCloseMercadoPagoReturnTab()
      })
  }, [searchParams, setSearchParams, slug])

  useEffect(() => {
    if (!awaitingPayment || !orderId || !slug) return

    let cancelled = false

    async function syncPayment() {
      try {
        const order = await apiGetPublic<OrderPayment>(`/api/public/salons/${slug}/store/orders/${orderId}`)
        if (cancelled) return
        setError(null)
        if (order.paymentStatus === 'paid') {
          setPaidOrder(order)
          setAwaitingPayment(false)
          setCheckoutUrl(null)
          setCheckoutOpen(false)
          closeMercadoPagoCheckout(mpWindowRef.current)
          mpWindowRef.current = null
        } else if (order.status === 'cancelled') {
          setAwaitingPayment(false)
          setCheckoutUrl(null)
          setError('El pago no se completó o venció. El pedido fue cancelado.')
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error && reason.message ? reason.message : 'No se pudo verificar el pago.')
      }
    }

    void syncPayment()
    const interval = window.setInterval(() => void syncPayment(), 4000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [awaitingPayment, orderId, slug])

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!slug || !checkoutLines.length || invalidCheckout || submitting) return

    setSubmitting(true)
    setError(null)

    const form = new FormData(event.currentTarget)
    const payload = {
      items: checkoutLines,
      paymentMethod,
      customerName: form.get('name'),
      customerPhone: form.get('phone'),
      customerEmail: form.get('email'),
    }
    const checkoutFromCart = checkoutItems === null

    try {
      const created = await apiPostPublic<CreatedOrder>(`/api/public/salons/${slug}/store/orders`, payload)
      setOrderId(created.id)
      if (checkoutFromCart) {
        setCart([])
        try {
          localStorage.removeItem(`store-cart:${slug}`)
        } catch {
          setError('El pedido se creó, pero no se pudo vaciar el carrito guardado en este navegador.')
        }
      }
      setCheckoutItems(null)
      setCheckoutOpen(false)

      if (created.checkoutUrl) {
        setCheckoutUrl(created.checkoutUrl)
        setAwaitingPayment(true)
        const host = window.location.hostname
        const canAutoReturn = window.location.protocol === 'https:'
          && host !== 'localhost'
          && host !== '127.0.0.1'
        if (canAutoReturn) {
          window.location.assign(created.checkoutUrl)
          return
        }
        mpWindowRef.current = openMercadoPagoCheckout(created.checkoutUrl)
      } else {
        setPaidOrder(created)
      }
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : 'No se pudo iniciar la compra.')
    } finally {
      setSubmitting(false)
    }
  }

  async function simulateTestPayment() {
    if (!slug || !orderId || !testMode) return
    setSubmitting(true)
    setError(null)
    try {
      const order = await apiPostPublic<OrderPayment>(
        `/api/public/salons/${slug}/store/orders/${orderId}/payment/demo`,
        {},
      )
      setPaidOrder(order)
      setAwaitingPayment(false)
      setCheckoutUrl(null)
      setCheckoutOpen(false)
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : 'No se pudo simular el pago.')
    } finally {
      setSubmitting(false)
    }
  }

  function closeCheckout() {
    if (submitting) return
    setCheckoutOpen(false)
    setCheckoutItems(null)
    setError(null)
  }

  if (error && !data) {
    return (
      <main className="reserva-contenedor">
        <section className="reserva-tarjeta vacio-situacion">
          <Brand compact />
          <h1>Tienda no disponible</h1>
          <p>{error}</p>
          {slug ? (
            <Link className="secundario tienda-volver-enlace" to={`/s/${slug}`}>
              Volver a reservas
            </Link>
          ) : null}
        </section>
      </main>
    )
  }

  if (!data) {
    return <main className="reserva-contenedor"><span className="aplicacion-carga-simbolo" /></main>
  }

  return (
    <main className="reserva-contenedor reserva-contenedor-tienda">
      <header className="reserva-header">
        <div className="reserva-header-inicio">
          {data.salon.logoUrl ? (
            <img className="reserva-header-logotipo" src={data.salon.logoUrl} alt={data.salon.name} />
          ) : (
            <Brand compact />
          )}
        </div>
        <div className="reserva-header-datos">
          <strong>{data.salon.name}</strong>
          <span>Tienda del salón</span>
        </div>
      </header>

      <section className="reserva-tarjeta">
        <div className="reserva-titulo tienda-titulo">
          <div>
            <h1>Productos</h1>
            {!mercadoPagoEnabled ? <p>Retiro y pago en el salón.</p> : null}
          </div>
          <button
            ref={cartButtonRef}
            type="button"
            className="tienda-carrito-boton"
            aria-haspopup="dialog"
            aria-expanded={cartOpen}
            onClick={() => setCartOpen(true)}
          >
            <ShoppingCart size={20} strokeWidth={1.8} />
            <span>Carrito</span>
            {cartCount > 0 ? (
              <span className="tienda-carrito-boton-cantidad" aria-live="polite" aria-atomic="true">
                {cartCount}
              </span>
            ) : null}
          </button>
        </div>

        {slug ? (
          <p className="tienda-navegacion">
            <Link className="secundario" to={`/s/${slug}`}>
              Reservar turno
            </Link>
          </p>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        {data.products.length === 0 ? (
          <div className="vacio-situacion">
            <h2>Sin productos por ahora</h2>
          </div>
        ) : null}

        {data.products.length > 0 ? (
          <div className="producto-administracion-estructura tienda-estructura">
            <aside className="producto-barra-lateral" aria-label="Filtros">
              {categories.length > 0 ? (
                <fieldset className="producto-barra-lateral-grupo">
                  <legend>Categorías</legend>
                  <label className="producto-barra-lateral-opcion">
                    <input
                      type="radio"
                      name="store-category"
                      checked={activeCategory === ''}
                      onChange={() => setActiveCategory('')}
                    />
                    Todas <small>{data.products.length}</small>
                  </label>
                  {categories.map((category) => (
                    <label className="producto-barra-lateral-opcion" key={category}>
                      <input
                        type="radio"
                        name="store-category"
                        checked={activeCategory === category}
                        onChange={() => setActiveCategory(category)}
                      />
                      {category} <small>{categoryCounts.get(category) ?? 0}</small>
                    </label>
                  ))}
                </fieldset>
              ) : null}

              {brands.length > 0 ? (
                <fieldset className="producto-barra-lateral-grupo">
                  <legend>Marcas</legend>
                  {brands.map((brand) => (
                    <label className="producto-barra-lateral-opcion" key={brand}>
                      <input type="checkbox" checked={brandFilter.includes(brand)} onChange={() => toggleBrand(brand)} />
                      {brand}
                    </label>
                  ))}
                </fieldset>
              ) : null}

              <fieldset className="producto-barra-lateral-grupo">
                <legend>Precio</legend>
                {priceRanges.map((range) => (
                  <button
                    type="button"
                    key={range.label}
                    className={`producto-barra-lateral-enlace${minPrice === range.min && maxPrice === range.max ? ' esta-activo' : ''}`}
                    onClick={() => {
                      setMinPrice(range.min)
                      setMaxPrice(range.max)
                    }}
                  >
                    {range.label}
                  </button>
                ))}
                <div className="producto-barra-lateral-rango">
                  <input
                    type="number"
                    min="0"
                    placeholder="Desde"
                    aria-label="Precio mínimo"
                    value={minPrice}
                    onChange={(event) => setMinPrice(event.target.value)}
                  />
                  <input
                    type="number"
                    min="0"
                    placeholder="Hasta"
                    aria-label="Precio máximo"
                    value={maxPrice}
                    onChange={(event) => setMaxPrice(event.target.value)}
                  />
                </div>
              </fieldset>

              {hasSizes ? (
                <fieldset className="producto-barra-lateral-grupo">
                  <legend>Tamaño</legend>
                  {sizeRanges.map((range) => (
                    <button
                      type="button"
                      key={range.label}
                      className={`producto-barra-lateral-enlace${minSize === range.min && maxSize === range.max ? ' esta-activo' : ''}`}
                      onClick={() => {
                        setMinSize(range.min)
                        setMaxSize(range.max)
                      }}
                    >
                      {range.label}
                    </button>
                  ))}
                  <div className="producto-barra-lateral-rango">
                    <input
                      type="number"
                      min="0"
                      placeholder="Desde"
                      aria-label="Tamaño mínimo en ml"
                      value={minSize}
                      onChange={(event) => setMinSize(event.target.value)}
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="Hasta"
                      aria-label="Tamaño máximo en ml"
                      value={maxSize}
                      onChange={(event) => setMaxSize(event.target.value)}
                    />
                  </div>
                </fieldset>
              ) : null}

              {activeChips.length > 0 ? (
                <button type="button" className="secundario" onClick={clearFilters}>
                  Limpiar filtros
                </button>
              ) : null}
            </aside>

            <div>
              <div className="producto-resultados-cabecera">
                <div>
                  <h2>{activeCategory || 'Todos los productos'}</h2>
                  <small>
                    {visibleProducts.length} {visibleProducts.length === 1 ? 'resultado' : 'resultados'}
                  </small>
                </div>
                <div className="tienda-resultados-acciones">
                  <div className="ordenar-menu" ref={sortMenuRef}>
                    <span>Ordenar por</span>
                    <button
                      type="button"
                      className="ordenar-menu-boton"
                      aria-haspopup="listbox"
                      aria-expanded={sortOpen}
                      onClick={() => setSortOpen((open) => !open)}
                    >
                      {sortOptions.find((option) => option.value === sortBy)?.label}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {sortOpen ? (
                      <ul className="ordenar-menu-lista" role="listbox">
                        {sortOptions.map((option) => (
                          <li key={option.value} role="option" aria-selected={option.value === sortBy}>
                            <button
                              type="button"
                              className={option.value === sortBy ? 'esta-activo' : ''}
                              onClick={() => {
                                setSortBy(option.value)
                                setSortOpen(false)
                              }}
                            >
                              {option.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </div>

              {activeChips.length > 0 ? (
                <div className="producto-etiquetas">
                  {activeChips.map((chip) => (
                    <button type="button" key={chip.key} className="producto-etiquetas-elemento" onClick={chip.clear}>
                      {chip.label} <span aria-hidden="true">×</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="producto-administracion-filtros">
                <label className="lista-busqueda">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="search"
                    placeholder="Buscar producto"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    aria-label="Buscar productos"
                  />
                </label>
              </div>

              {visibleProducts.length === 0 ? <p className="vacio-situacion">No hay productos con ese filtro</p> : null}

              <ul className="tienda-grid">
                {visibleProducts.map((product) => (
                  <li className="tienda-tarjeta" key={product.id}>
                    {product.imageUrl ? (
                      <img className="tienda-tarjeta-imagen" src={product.imageUrl} alt="" />
                    ) : (
                      <span className="tienda-tarjeta-marcador" aria-hidden="true">
                        {product.name.trim().charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="tienda-tarjeta-cuerpo">
                      <h2>{product.name}</h2>
                      {product.category ? <small className="producto-administracion-tarjeta-categoria">{product.category}</small> : null}
                      {product.brand || product.sizeMl ? (
                        <small>
                          {[product.brand, product.sizeMl ? `${product.sizeMl} ml` : null].filter(Boolean).join(' · ')}
                        </small>
                      ) : null}
                      {product.description ? <p>{product.description}</p> : null}
                      <strong className="tienda-tarjeta-precio">{formatPrice(product.price)}</strong>
                      {!product.inStock ? <span className="tienda-tarjeta-agotado">Agotado</span> : null}
                      {product.price > 0 && product.inStock ? (
                        <div className="tienda-tarjeta-acciones">
                          <button
                            type="button"
                            className="secundario tienda-tarjeta-agregar"
                            disabled={
                              (cart.length >= 50 && !cart.some((item) => item.productId === product.id))
                              || (cart.find((item) => item.productId === product.id)?.quantity ?? 0) >= 99
                            }
                            onClick={() => {
                              changeQuantity(
                                product.id,
                                (cart.find((item) => item.productId === product.id)?.quantity ?? 0) + 1,
                              )
                              setError(null)
                            }}
                          >
                            Agregar al carrito
                          </button>
                          <button
                            type="button"
                            className="primary tienda-tarjeta-comprar"
                            onClick={() => buyProductNow(product.id)}
                          >
                            Comprar ahora
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </section>

      {paidOrder ? (
        <div className="modal-fondo tienda-pago-fondo">
          <section className="modal-tarjeta tienda-exito" role="dialog" aria-modal="true" aria-labelledby="compra-realizada-titulo">
            <h2 id="compra-realizada-titulo">{paidOrder.paymentStatus === 'paid' ? 'Compra realizada!' : 'Reserva confirmada'}</h2>
            <ul className="tienda-compra-productos">
              {paidOrder.items.map((item) => (
                <li key={item.productId}>
                  <span>{item.productName} × {item.quantity}</span>
                  <strong>{formatPrice(item.unitPrice * item.quantity)}</strong>
                </li>
              ))}
            </ul>
            <strong>Total: {formatPrice(paidOrder.amount)}</strong>
            <p>{paidOrder.paymentStatus === 'paid' ? 'Pago acreditado.' : 'Pago al retirar.'}</p>
            <p>{paidOrder.status === 'awaiting_stock' ? 'Disponibilidad pendiente de confirmación.' : 'Retiro en el salón.'}</p>
            <p>Pedido: {paidOrder.id}</p>
            <button type="button" className="primary" autoFocus onClick={() => setPaidOrder(null)}>
              Seguir comprando
            </button>
          </section>
        </div>
      ) : null}

      {cartOpen ? (
        <div
          className="modal-fondo tienda-carrito-fondo"
          role="presentation"
          onClick={() => setCartOpen(false)}
        >
          <section
            ref={cartPanelRef}
            className="modal-tarjeta tienda-carrito-modal"
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="store-cart-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="tienda-carrito-modal-header">
              <div>
                <h2 id="store-cart-title">Carrito</h2>
                <p>
                  {cartCount} {cartCount === 1 ? 'producto' : 'productos'}
                </p>
              </div>
              <button
                type="button"
                className="secundario"
                aria-label="Cerrar carrito"
                onClick={() => setCartOpen(false)}
              >
                Cerrar
              </button>
            </header>
            {cartCount === 0 ? (
              <div className="tienda-carrito-modal-vacio">
                <p>Carrito vacío.</p>
                <button type="button" className="primary" onClick={() => setCartOpen(false)}>
                  Ver productos
                </button>
              </div>
            ) : (
              <>
                <ul className="tienda-carrito-elementos">
                  {cartItems.map((item) => (
                    <li key={item.productId}>
                      <span>{item.product?.name ?? 'Producto no disponible'}</span>
                      <div className="tienda-carrito-cantidad">
                        <button
                          type="button"
                          className="secundario"
                          aria-label={`Quitar una unidad de ${item.product?.name ?? 'producto'}`}
                          onClick={() => changeQuantity(item.productId, item.quantity - 1)}
                        >
                          −
                        </button>
                        <span aria-live="polite">{item.quantity}</span>
                        <button
                          type="button"
                          className="secundario"
                          disabled={item.quantity >= 99}
                          aria-label={`Agregar una unidad de ${item.product?.name ?? 'producto'}`}
                          onClick={() => changeQuantity(item.productId, item.quantity + 1)}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          className="tienda-carrito-eliminar"
                          aria-label={`Eliminar ${item.product?.name ?? 'producto'} del carrito`}
                          onClick={() => changeQuantity(item.productId, 0)}
                        >
                          <span aria-hidden="true">×</span>
                        </button>
                      </div>
                      <strong>{formatPrice((item.product?.price ?? 0) * item.quantity)}</strong>
                    </li>
                  ))}
                </ul>
                {invalidCart ? (
                  <p className="error">Quitá los productos agotados o no disponibles para continuar.</p>
                ) : null}
                <div className="tienda-carrito-footer">
                  <strong>Total: {formatPrice(cartTotal)}</strong>
                  <button
                    type="button"
                    className="primary"
                    disabled={invalidCart || awaitingPayment}
                    onClick={openCartCheckout}
                  >
                    Pagar
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}

      {checkoutOpen ? (
        <div className="modal-fondo tienda-pago-fondo" role="presentation" onClick={closeCheckout}>
          <div
            className="modal-tarjeta modal-tarjeta-form tienda-finalizar-compra-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="store-checkout-title"
            onClick={(event) => event.stopPropagation()}
          >
            <form className="modal-form" onSubmit={(event) => void submitOrder(event)}>
              <h2 id="store-checkout-title">
                {checkoutItems ? 'Comprar ahora' : 'Pagar'}
              </h2>
              <p className="modal-tarjeta-subheader">
                {checkoutCount} {checkoutCount === 1 ? 'producto' : 'productos'} · Total: {formatPrice(checkoutTotal)}
              </p>
              <section aria-label="Resumen de la compra">
                <ul className="tienda-compra-productos">
                  {checkoutDetails.map((item) => (
                    <li key={item.productId}>
                      <span>{item.product?.name ?? 'Producto no disponible'} × {item.quantity}</span>
                      <strong>{formatPrice((item.product?.price ?? 0) * item.quantity)}</strong>
                    </li>
                  ))}
                </ul>
              </section>
              <label>
                Forma de pago
                <select value={paymentMethod} disabled={submitting}
                  onChange={(event) => setPaymentMethod(event.target.value === 'mercadopago' ? 'mercadopago' : 'salon')}>
                  <option value="salon">Reservar y pagar al retirar</option>
                  {mercadoPagoEnabled ? <option value="mercadopago">Pagar ahora con Mercado Pago</option> : null}
                </select>
              </label>

              <label>
                Nombre y apellido
                <input name="name" type="text" required autoComplete="name" disabled={submitting} />
              </label>
              <label>
                Teléfono (WhatsApp)
                <input name="phone" type="tel" required autoComplete="tel" disabled={submitting} />
              </label>
              <label>
                Email
                <input name="email" type="email" required autoComplete="email" disabled={submitting} />
              </label>

              {paymentMethod === 'mercadopago' ? <div className="tienda-finalizar-compra-mercadopago">
                <img src={mercadoPagoLogo} alt="Mercado Pago" width={120} height={32} />
                <span>Pago seguro con Mercado Pago</span>
              </div> : null}

              {error ? <p className="error">{error}</p> : null}

              <div className="modal-form-acciones">
                <button type="submit" className="primary" disabled={submitting || invalidCheckout}>
                  {submitting ? 'Procesando…' : paymentMethod === 'mercadopago' ? 'Ir a Mercado Pago' : 'Confirmar reserva'}
                </button>
                <button type="button" className="secundario" disabled={submitting} onClick={closeCheckout}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {awaitingPayment ? (
        <div className="modal-fondo" role="presentation">
          <div className="modal-tarjeta reserva-confirmar-modal" role="dialog" aria-modal="true">
            <h2>Completá el pago</h2>
            <p>Abrimos Mercado Pago en otra pestaña. Cuando se acredite, confirmamos tu compra acá.</p>
            {checkoutUrl ? <button
              type="button"
              className="primary"
              onClick={() => {
                mpWindowRef.current = openMercadoPagoCheckout(checkoutUrl)
              }}
            >
              Reabrir Mercado Pago
            </button> : null}
            <p>Pedido: {orderId}. El estado se actualiza automáticamente.</p>
            {error ? <p className="error">{error}</p> : null}
            <button type="button" className="secundario" onClick={() => { setAwaitingPayment(false); setCheckoutUrl(null) }}>
              Seguir viendo la tienda
            </button>
            {testMode ? (
              <button type="button" className="secundario" disabled={submitting} onClick={() => void simulateTestPayment()}>
                Simular pago (prueba)
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  )
}
