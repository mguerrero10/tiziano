import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { hasModule } from '../lib/modules'
import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api'
import { uploadProductImage } from '../lib/productImage'

type Product = {
  id: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  active: boolean
  sortOrder: number
  category: string | null
  stock: number | null
  brand: string | null
  sizeMl: number | null
}

type ProductFormState = {
  brand: string
  sizeMl: string
  name: string
  description: string
  price: string
  active: boolean
  category: string
  stock: string
}

const emptyForm: ProductFormState = {
  brand: '',
  sizeMl: '',
  name: '',
  description: '',
  price: '',
  active: true,
  category: '',
  stock: '',
}

type SortBy = 'relevance' | 'price-asc' | 'price-desc' | 'name'

const sortOptions: { value: SortBy; label: string }[] = [
  { value: 'relevance', label: 'Más relevantes' },
  { value: 'price-asc', label: 'Menor precio' },
  { value: 'price-desc', label: 'Mayor precio' },
  { value: 'name', label: 'Nombre (A-Z)' },
]

const LOW_STOCK_LIMIT = 5
const NO_BRAND = '__none__'

type StockFilter = 'all' | 'low' | 'out' | 'untracked'

const stockOptions: { value: StockFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'low', label: `Stock bajo (${LOW_STOCK_LIMIT} o menos)` },
  { value: 'out', label: 'Sin stock' },
  { value: 'untracked', label: 'Sin control de stock' },
]

function matchesStock(product: Product, filter: StockFilter) {
  if (filter === 'low') return product.stock !== null && product.stock > 0 && product.stock <= LOW_STOCK_LIMIT
  if (filter === 'out') return product.stock === 0
  if (filter === 'untracked') return product.stock === null
  return true
}

const suggestedBrands = [
  'Sedal', 'Pantene', 'Head & Shoulders', 'Dove', 'Elvive', 'Tresemmé', 'Plusbelle', 'Herbal Essences',
  'Kérastase', "L'Oréal Professionnel", 'Wella Professionals', 'Schwarzkopf Professional', 'Redken',
]

const suggestedSizes = [100, 250, 300, 400, 500, 750, 1000]

const sizeRanges = [
  { label: 'Hasta 250 ml', min: '', max: '250' },
  { label: '250 a 500 ml', min: '250', max: '500' },
  { label: '500 a 1000 ml', min: '500', max: '1000' },
  { label: 'Más de 1000 ml', min: '1000', max: '' },
]

function formatPrice(value: number) {
  return value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })
}

export function ProductsPage() {
  const { session, me } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [productToDelete, setProductToDelete] = useState<Product | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [brandFilter, setBrandFilter] = useState<string[]>([])
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [minSize, setMinSize] = useState('')
  const [maxSize, setMaxSize] = useState('')
  const [zoomImage, setZoomImage] = useState<string | null>(null)
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')
  const [sortBy, setSortBy] = useState<SortBy>('relevance')
  const [sortOpen, setSortOpen] = useState(false)
  const sortMenuRef = useRef<HTMLDivElement>(null)

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
  const [form, setForm] = useState<ProductFormState>(emptyForm)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)

  useEffect(() => {
    if (!session) return
    setLoading(true)
    apiGet<Product[]>('/api/products', session.access_token)
      .then(setProducts)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los productos.')
      })
      .finally(() => setLoading(false))
  }, [session])

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(null), 4000)
    return () => window.clearTimeout(timer)
  }, [message])

  useEffect(() => {
    if (!zoomImage) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setZoomImage(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomImage])

  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null)
      return
    }
    const url = URL.createObjectURL(imageFile)
    setImagePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setImageFile(null)
    setFileInputKey((value) => value + 1)
    setError(null)
    setMessage(null)
    setModalOpen(true)
  }

  function openEdit(product: Product) {
    setEditing(product)
    setForm({
      name: product.name,
      description: product.description ?? '',
      price: String(product.price),
      active: product.active,
      category: product.category ?? '',
      stock: product.stock === null ? '' : String(product.stock),
      brand: product.brand ?? '',
      sizeMl: product.sizeMl === null ? '' : String(product.sizeMl),
    })
    setImageFile(null)
    setImagePreview(product.imageUrl)
    setFileInputKey((value) => value + 1)
    setError(null)
    setMessage(null)
    setModalOpen(true)
  }

  function closeModal() {
    if (saving) return
    setModalOpen(false)
    setEditing(null)
    setForm(emptyForm)
    setImageFile(null)
    setImagePreview(null)
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setImageFile(event.target.files?.[0] ?? null)
    setError(null)
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault()
    if (!session || !me?.salon) return

    const name = form.name.trim()
    const price = Number(form.price.trim().replace(',', '.'))
    if (!name) {
      setError('Indicá el nombre del producto.')
      return
    }
    if (!Number.isFinite(price) || price < 0) {
      setError('Ingresá un precio válido.')
      return
    }

    const stockText = form.stock.trim()
    const stock = stockText === '' ? null : Number(stockText)
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
      setError('El stock tiene que ser un número entero, 0 o mayor.')
      return
    }

    const sizeText = form.sizeMl.trim()
    const sizeMl = sizeText === '' ? null : Number(sizeText)
    if (sizeMl !== null && (!Number.isInteger(sizeMl) || sizeMl <= 0)) {
      setError('El tamaño tiene que ser un número entero de ml mayor a 0.')
      return
    }

    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const description = form.description.trim()
      const body = {
        name,
        description: description || null,
        price,
        active: form.active,
        category: form.category.trim(),
        brand: form.brand.trim(),
        ...(sizeMl === null ? (editing ? { clearSizeMl: true } : {}) : { sizeMl }),
        ...(stock === null ? (editing ? { clearStock: true } : {}) : { stock }),
      }

      let product: Product
      if (editing) {
        product = await apiPatch<Product>(`/api/products/${editing.id}`, session.access_token, body)
      } else {
        product = await apiPost<Product>('/api/products', session.access_token, body)
      }

      if (imageFile) {
        const imageUrl = await uploadProductImage(me.salon.id, product.id, imageFile)
        product = await apiPatch<Product>(`/api/products/${product.id}`, session.access_token, { imageUrl })
      }

      setProducts((current) => {
        if (editing) {
          return current.map((item) => (item.id === product.id ? product : item))
        }
        return [...current, product].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      })
      setMessage(editing ? 'Producto actualizado.' : 'Producto agregado al catálogo.')
      closeModal()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar el producto.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(product: Product) {
    if (!session) return
    setSaving(true)
    setError(null)
    try {
      const updated = await apiPatch<Product>(`/api/products/${product.id}`, session.access_token, {
        active: !product.active,
      })
      setProducts((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar el producto.')
    } finally {
      setSaving(false)
    }
  }

  function askRemove(product: Product) {
    setError(null)
    setMessage(null)
    setProductToDelete(product)
  }

  function cancelRemove() {
    if (deletingId) return
    setProductToDelete(null)
  }

  async function confirmRemove() {
    if (!session || !productToDelete) return
    const product = productToDelete
    setDeletingId(product.id)
    setError(null)
    try {
      await apiDelete(`/api/products/${product.id}`, session.access_token)
      setProducts((current) => current.filter((item) => item.id !== product.id))
      setMessage('Producto eliminado.')
      setProductToDelete(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo eliminar el producto.')
      setProductToDelete(null)
    } finally {
      setDeletingId(null)
    }
  }

  const categories = useMemo(() => {
    const names = new Set<string>()
    for (const product of products) {
      if (product.category) names.add(product.category)
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'es'))
  }, [products])

  const brands = useMemo(() => {
    const names = new Set<string>()
    for (const product of products) {
      if (product.brand) names.add(product.brand)
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'es'))
  }, [products])

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    const minP = minPrice === '' ? null : Number(minPrice)
    const maxP = maxPrice === '' ? null : Number(maxPrice)
    const minS = minSize === '' ? null : Number(minSize)
    const maxS = maxSize === '' ? null : Number(maxSize)
    const filtered = products.filter((product) => {
      if (!matchesStock(product, stockFilter)) return false
      if (categoryFilter === '__none__' && product.category) return false
      if (categoryFilter && categoryFilter !== '__none__' && product.category !== categoryFilter) return false
      if (term && !product.name.toLowerCase().includes(term)) return false
      if (brandFilter.length > 0) {
        const matchesBrand = product.brand ? brandFilter.includes(product.brand) : brandFilter.includes(NO_BRAND)
        if (!matchesBrand) return false
      }
      if (minP !== null && product.price < minP) return false
      if (maxP !== null && product.price > maxP) return false
      if ((minS !== null || maxS !== null) && product.sizeMl === null) return false
      if (minS !== null && product.sizeMl !== null && product.sizeMl < minS) return false
      if (maxS !== null && product.sizeMl !== null && product.sizeMl > maxS) return false
      return true
    })
    if (sortBy === 'price-asc') filtered.sort((a, b) => a.price - b.price)
    else if (sortBy === 'price-desc') filtered.sort((a, b) => b.price - a.price)
    else if (sortBy === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name, 'es'))
    return filtered
  }, [products, search, categoryFilter, brandFilter, minPrice, maxPrice, minSize, maxSize, stockFilter, sortBy])

  const stockCounts = useMemo(() => {
    const counts: Record<StockFilter, number> = { all: products.length, low: 0, out: 0, untracked: 0 }
    for (const product of products) {
      if (matchesStock(product, 'low')) counts.low += 1
      if (matchesStock(product, 'out')) counts.out += 1
      if (matchesStock(product, 'untracked')) counts.untracked += 1
    }
    return counts
  }, [products])

  const priceRanges = useMemo(() => {
    const prices = products.map((product) => product.price).filter((value) => value > 0).sort((a, b) => a - b)
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
  }, [products])

  const activeChips: { key: string; label: string; clear: () => void }[] = []
  if (categoryFilter) {
    activeChips.push({
      key: 'cat',
      label: categoryFilter === '__none__' ? 'Sin categoría' : categoryFilter,
      clear: () => setCategoryFilter(''),
    })
  }
  for (const brand of brandFilter) {
    activeChips.push({
      key: `brand-${brand}`,
      label: brand === NO_BRAND ? 'Sin marca' : brand,
      clear: () => toggleBrand(brand),
    })
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
  if (stockFilter !== 'all') {
    activeChips.push({
      key: 'stock',
      label: stockOptions.find((option) => option.value === stockFilter)?.label ?? 'Stock',
      clear: () => setStockFilter('all'),
    })
  }

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const product of products) {
      const key = product.category ?? '__none__'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [products])

  const hasActiveFilters =
    activeChips.length > 0

  function clearFilters() {
    setStockFilter('all')
    setCategoryFilter('')
    setBrandFilter([])
    setMinPrice('')
    setMaxPrice('')
    setMinSize('')
    setMaxSize('')
  }

  function toggleBrand(brand: string) {
    setBrandFilter((current) =>
      current.includes(brand) ? current.filter((item) => item !== brand) : [...current, brand],
    )
  }

  const hasUncategorized = products.some((product) => !product.category)
  const previewImage = imagePreview ?? editing?.imageUrl ?? null
  const storePublicUrl = me?.salon?.slug ? `/s/${me.salon.slug}/tienda` : null
  const storeVisible = me?.salon?.storeEnabled === true

  return (
    <div className="panel">
      <section className="header-panel">
        <div>
          <span className="antetitulo">Catálogo</span>
          <h1>Productos</h1>
          <p>Espacio para gestionar tu tienda</p>
        </div>
        <div className="acciones-header-panel">
          {storePublicUrl && storeVisible ? (
            <a className="primary primary-solid primary-claro primary-compacta" href={storePublicUrl} target="_blank" rel="noreferrer">
              Ver tienda pública
            </a>
          ) : null}
          <button
            type="button"
            className="primary primary-solid primary-compacta"
            disabled={!session || loading}
            onClick={openCreate}
          >
            Nuevo producto
          </button>
        </div>
      </section>

      {hasModule(me?.enabledModules, 'products') && !storeVisible ? (
        <section className="tarjeta-panel tienda-administracion-ayuda">
          <p>
            La tienda está <strong>oculta</strong> para tus clientes. Activala en{' '}
            <Link to="/ajustes">Ajustes / Tienda online</Link>.
          </p>
        </section>
      ) : null}

      {hasModule(me?.enabledModules, 'products') ? (
      <section className="tarjeta-panel">
        {error && !modalOpen ? <p className="error">{error}</p> : null}

        {loading ? null : products.length === 0 ? (
          <p className="vacio-situacion">Sin productos</p>
        ) : (
          <>
          <div className="producto-administracion-estructura">
          <aside className="producto-barra-lateral" aria-label="Filtros">
            <fieldset className="producto-barra-lateral-grupo">
              <legend>Categorías</legend>
              <label className="producto-barra-lateral-opcion">
                <input
                  type="radio"
                  name="product-category"
                  checked={categoryFilter === ''}
                  onChange={() => setCategoryFilter('')}
                />
                Todas <small>{products.length}</small>
              </label>
              {categories.map((category) => (
                <label className="producto-barra-lateral-opcion" key={category}>
                  <input
                    type="radio"
                    name="product-category"
                    checked={categoryFilter === category}
                    onChange={() => setCategoryFilter(category)}
                  />
                  {category} <small>{categoryCounts.get(category) ?? 0}</small>
                </label>
              ))}
              {hasUncategorized ? (
                <label className="producto-barra-lateral-opcion">
                  <input
                    type="radio"
                    name="product-category"
                    checked={categoryFilter === '__none__'}
                    onChange={() => setCategoryFilter('__none__')}
                  />
                  Sin categoría <small>{categoryCounts.get('__none__') ?? 0}</small>
                </label>
              ) : null}
            </fieldset>

            <fieldset className="producto-barra-lateral-grupo">
              <legend>Marcas</legend>
              {brands.length === 0 ? (
                <small>Sin marcas registradas.</small>
              ) : null}
              {brands.map((brand) => (
                <label className="producto-barra-lateral-opcion" key={brand}>
                  <input type="checkbox" checked={brandFilter.includes(brand)} onChange={() => toggleBrand(brand)} />
                  {brand}
                </label>
              ))}
              {products.some((product) => !product.brand) ? (
                <label className="producto-barra-lateral-opcion">
                  <input
                    type="checkbox"
                    checked={brandFilter.includes(NO_BRAND)}
                    onChange={() => toggleBrand(NO_BRAND)}
                  />
                  Sin marca <small>{products.filter((product) => !product.brand).length}</small>
                </label>
              ) : null}
            </fieldset>

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

            <fieldset className="producto-barra-lateral-grupo">
              <legend>Stock</legend>
              {stockOptions.map((option) => (
                <label className="producto-barra-lateral-opcion" key={option.value}>
                  <input
                    type="radio"
                    name="product-stock"
                    checked={stockFilter === option.value}
                    onChange={() => setStockFilter(option.value)}
                  />
                  {option.label} <small>{stockCounts[option.value]}</small>
                </label>
              ))}
            </fieldset>

            {hasActiveFilters ? (
              <button type="button" className="secundario" onClick={clearFilters}>
                Limpiar filtros
              </button>
            ) : null}
          </aside>
          <div>
          <div className="producto-resultados-cabecera">
            <div>
              <h2>{categoryFilter && categoryFilter !== '__none__' ? categoryFilter : 'Todos los productos'}</h2>
              <small>
                {visibleProducts.length} {visibleProducts.length === 1 ? 'resultado' : 'resultados'}
              </small>
            </div>
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
          <div className="producto-administracion-grid">
            {visibleProducts.map((product) => (
              <article
                className={`producto-administracion-tarjeta${product.active ? '' : ' producto-administracion-tarjeta-inactivo'}`}
                key={product.id}
              >
                <button
                  type="button"
                  className="producto-administracion-tarjeta-quitar"
                  aria-label={`Eliminar ${product.name}`}
                  title="Eliminar"
                  disabled={deletingId === product.id}
                  onClick={() => askRemove(product)}
                >
                  ×
                </button>
                {product.imageUrl ? (
                  <img className="producto-administracion-tarjeta-imagen" src={product.imageUrl} alt="" />
                ) : (
                  <span className="producto-administracion-tarjeta-marcador" aria-hidden="true">
                    {product.name.trim().charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="producto-administracion-tarjeta-cuerpo">
                  <span className={`estado ${product.active ? 'estado-confirmado' : 'estado-cancelado'}`}>
                    {product.active ? 'Visible en tienda' : 'Oculto'}
                  </span>
                  <h2>{product.name}</h2>
                  {product.category ? <small className="producto-administracion-tarjeta-categoria">{product.category}</small> : null}
                  {product.brand || product.sizeMl ? (
                    <small>{[product.brand, product.sizeMl ? `${product.sizeMl} ml` : null].filter(Boolean).join(' · ')}</small>
                  ) : null}
                  <p>{product.description || 'Sin descripción'}</p>
                  <strong>{formatPrice(product.price)}</strong>
                  {product.stock === null ? null : (
                    <small
                      className={`producto-administracion-tarjeta-existencias${product.stock === 0 ? ' producto-administracion-tarjeta-existencias-vacio' : ''}`}
                    >
                      {product.stock === 0 ? 'Sin stock' : `Stock: ${product.stock}`}
                    </small>
                  )}
                </div>
                <footer className="producto-administracion-tarjeta-acciones">
                  <button type="button" className="secundario" disabled={saving} onClick={() => openEdit(product)}>
                    Editar
                  </button>
                  <button type="button" className="secundario" disabled={saving} onClick={() => void toggleActive(product)}>
                    {product.active ? 'Ocultar' : 'Mostrar'}
                  </button>
                </footer>
              </article>
            ))}
          </div>
          </div>
          </div>
          </>
        )}
      </section>
      ) : null}

      {productToDelete ? (
        <div className="modal-fondo" role="presentation" onClick={cancelRemove}>
          <div
            className="modal-tarjeta"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="product-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="product-delete-title">¿Seguro que querés eliminar este producto?</h2>
            <p className="modal-tarjeta-subheader">
              «{productToDelete.name}» se va a borrar del catálogo y de la tienda. Esta acción no se puede deshacer.
            </p>
            <div className="modal-form-acciones modal-form-acciones-centrado">
              <button
                type="button"
                className="primary primary-peligro"
                disabled={deletingId !== null}
                onClick={() => void confirmRemove()}
              >
                {deletingId ? 'Eliminando…' : 'Eliminar'}
              </button>
              <button type="button" className="secundario" disabled={deletingId !== null} onClick={cancelRemove}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modalOpen ? (
        <div className="modal-fondo" role="presentation" onClick={closeModal}>
          <div
            className="modal-tarjeta modal-tarjeta-form"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-form-title"
            onClick={(event) => event.stopPropagation()}
          >
            <form className="modal-form" onSubmit={(event) => void saveProduct(event)}>
              <h2 id="product-form-title">{editing ? 'Editar producto' : 'Nuevo producto'}</h2>

              <div className="producto-form-imagen">
                {previewImage ? (
                  <button
                    type="button"
                    className="producto-form-imagen-ampliar"
                    title="Ampliar imagen"
                    aria-label="Ampliar imagen"
                    onClick={() => setZoomImage(previewImage)}
                  >
                    <img src={previewImage} alt="Vista previa del producto" />
                  </button>
                ) : (
                  <span aria-hidden="true">Sin foto</span>
                )}
                <label className="ajustes-logotipo-archivo">
                  Elegir foto
                  <input
                    key={fileInputKey}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={onFileChange}
                  />
                </label>
              </div>

              <label>
                Título
                <input
                  type="text"
                  required
                  maxLength={200}
                  value={form.name}
                  disabled={saving}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                />
              </label>

              <label>
                Descripción
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={form.description}
                  disabled={saving}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                />
              </label>

              <label>
                Precio (ARS)
                <input
                  type="number"
                  min="0"
                  step="100"
                  required
                  value={form.price}
                  disabled={saving}
                  onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
                />
              </label>

              <div className="producto-form-fila">
                <label>
                  Marca
                  <input
                    type="text"
                    list="product-brands"
                    maxLength={60}
                    placeholder="Ej: L'Oréal"
                    value={form.brand}
                    disabled={saving}
                    onChange={(event) => setForm((current) => ({ ...current, brand: event.target.value }))}
                  />
                  <datalist id="product-brands">
                    {[...new Set([...brands, ...suggestedBrands])].map((brand) => (
                      <option key={brand} value={brand} />
                    ))}
                  </datalist>
                </label>

                <label>
                  Tamaño (ml)
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Ej: 250"
                    list="product-sizes"
                    value={form.sizeMl}
                    disabled={saving}
                    onChange={(event) => setForm((current) => ({ ...current, sizeMl: event.target.value }))}
                  />
                  <datalist id="product-sizes">
                    {suggestedSizes.map((size) => (
                      <option key={size} value={size} />
                    ))}
                  </datalist>
                </label>
              </div>

              <div className="producto-form-fila">
                <label>
                  Categoría
                  <input
                    type="text"
                    list="product-categories"
                    maxLength={60}
                    placeholder="Ej: Shampoo"
                    value={form.category}
                    disabled={saving}
                    onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                  />
                  <datalist id="product-categories">
                    {categories.map((category) => (
                      <option key={category} value={category} />
                    ))}
                  </datalist>
                </label>

                <label>
                  Stock
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="Sin control"
                    value={form.stock}
                    disabled={saving}
                    onChange={(event) => setForm((current) => ({ ...current, stock: event.target.value }))}
                  />
                </label>
              </div>
              <small className="producto-form-ayuda">
                Dejá el stock vacío si no querés controlarlo. Con 0, el producto aparece agotado en la tienda.
              </small>

              <label className="ajustes-interruptor">
                <input
                  type="checkbox"
                  checked={form.active}
                  disabled={saving}
                  onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
                />
                Visible en la tienda pública
              </label>

              {error ? <p className="error">{error}</p> : null}

              <div className="modal-form-acciones">
                <button type="submit" className="primary" disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
                <button type="button" className="secundario" disabled={saving} onClick={closeModal}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {message ? (
        <div className="notificacion" role="status" aria-live="polite">
          <span>{message}</span>
          <button type="button" aria-label="Cerrar" onClick={() => setMessage(null)}>
            ×
          </button>
        </div>
      ) : null}

      {zoomImage ? (
        <div
          className="modal-fondo producto-ampliacion"
          role="dialog"
          aria-modal="true"
          aria-label="Imagen ampliada"
          onClick={() => setZoomImage(null)}
        >
          <button type="button" aria-label="Cerrar" onClick={() => setZoomImage(null)}>
            ×
          </button>
          <img src={zoomImage} alt="Imagen del producto ampliada" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </div>
  )
}
