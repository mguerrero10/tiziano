import { useEffect, useRef, useState } from 'react'
import {
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle,
  ChevronRight,
  CircleHelp,
  CreditCard,
  House,
  LogOut,
  Menu,
  Package,
  Settings,
  ShoppingCart,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Brand } from '../components/Brand'
import { hasBookingModules, hasModule } from '../lib/modules'
import { supabase } from '../lib/supabase'

function getInitials(name: string, email: string) {
  const source = name.trim() || email
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

type SidebarItem = {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

function SidebarLink({ item, onNavigate }: { item: SidebarItem; onNavigate: () => void }) {
  const Icon = item.icon

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `barra-lateral-enlace${isActive ? ' esta-activo' : ''}`}
      onClick={onNavigate}
      title={item.label}
    >
      <Icon size={20} strokeWidth={1.8} />
      <span>{item.label}</span>
    </NavLink>
  )
}

function SidebarGroup({
  id,
  title,
  icon,
  items,
  open,
  active,
  onToggle,
  onNavigate,
}: {
  id: string
  title: string
  icon: LucideIcon
  items: SidebarItem[]
  open: boolean
  active: boolean
  onToggle: () => void
  onNavigate: () => void
}) {
  const contentId = `sidebar-group-${id}`
  const Icon = icon

  return (
    <section className={`barra-lateral-grupo${active ? ' tiene-activo' : ''}`}>
      <button
        type="button"
        className="barra-lateral-grupo-interruptor"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
        title={title}
      >
        <Icon size={20} strokeWidth={1.8} />
        <span>{title}</span>
        <span className="barra-lateral-grupo-flecha" aria-hidden="true">
          <ChevronRight size={15} strokeWidth={1.8} />
        </span>
      </button>
      <div id={contentId} className="barra-lateral-grupo-opciones" hidden={!open}>
        {items.map((item) => (
          <SidebarLink key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </div>
    </section>
  )
}

function getActiveGroup(pathname: string, platform: boolean) {
  if (platform) return pathname.startsWith('/plataforma') ? 'platform' : null
  if (pathname === '/agenda' || pathname === '/clientes') return 'operations'
  if (pathname === '/servicios' || pathname === '/profesionales') return 'salon'
  if (pathname === '/productos' || pathname === '/pedidos') return 'store'
  return null
}

export function DashboardLayout() {
  const { session, me } = useAuth()
  const location = useLocation()
  const platform = location.pathname.startsWith('/plataforma')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [groupOverride, setGroupOverride] = useState(() => ({
    pathname: location.pathname,
    id: getActiveGroup(location.pathname, location.pathname.startsWith('/plataforma')),
  }))
  const userMenuRef = useRef<HTMLDivElement>(null)

  const email = session?.user.email ?? 'usuario@turnosalon.local'
  const metadataName = session?.user.user_metadata?.display_name
  const name = typeof metadataName === 'string' && metadataName.trim() ? metadataName : email.split('@')[0]
  const initials = getInitials(name, email)
  const enabledModules = me?.enabledModules ?? []
  const showBooking = hasBookingModules(enabledModules)
  const showProducts = hasModule(enabledModules, 'products')

  const activeGroup = getActiveGroup(location.pathname, platform)
  const expandedGroup = groupOverride.pathname === location.pathname
    ? groupOverride.id
    : activeGroup

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed))
  }, [collapsed])

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setUserMenuOpen(false)
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setUserMenuOpen(false)
        setMobileOpen(false)
      }
    }

    document.addEventListener('mousedown', closeMenus)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeMenus)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  async function signOut() {
    setUserMenuOpen(false)
    await supabase.auth.signOut()
  }

  function navigateFromSidebar() {
    setMobileOpen(false)
  }

  function renderGroup(id: string, title: string, icon: LucideIcon, items: SidebarItem[]) {
    const active = items.some((item) =>
      item.to === '/'
        ? location.pathname === '/'
        : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`),
    )
    return (
      <SidebarGroup
        key={id}
        id={id}
        title={title}
        icon={icon}
        items={items}
        open={expandedGroup === id}
        active={active}
        onToggle={() => setGroupOverride({
          pathname: location.pathname,
          id: expandedGroup === id ? null : id,
        })}
        onNavigate={() => {
          setGroupOverride({ pathname: location.pathname, id })
          navigateFromSidebar()
        }}
      />
    )
  }

  return (
    <div className={`aplicacion-estructura${collapsed ? ' aplicacion-estructura-contraida' : ''}${mobileOpen ? ' aplicacion-estructura-movil-abierto' : ''}`}>
      <aside className="barra-lateral" aria-label="Navegación principal">
        <div className="barra-lateral-marca">
          <Brand
            compact
            logoUrl={platform ? null : me?.salon?.logoUrl}
            name={platform ? null : me?.salon?.name}
          />
        </div>

        <nav className="barra-lateral-navegacion">
          {platform ? (
            <>
              <span className="barra-lateral-rotulo">Administración</span>
              {renderGroup('platform', 'Gestión de plataforma', Settings, [
                { to: '/plataforma', label: 'Resumen', icon: House, end: true },
                { to: '/plataforma/clientes', label: 'Salones', icon: UsersRound },
              ])}
              {me?.hasSalon ? (
                <>
                  <span className="barra-lateral-rotulo barra-lateral-rotulo-secundario">Acceso rápido</span>
                  <NavLink
                    to="/"
                    end
                    className={({ isActive }) => `barra-lateral-enlace${isActive ? ' esta-activo' : ''}`}
                    onClick={() => setMobileOpen(false)}
                    title="Ir al salón"
                  >
                    <CalendarDays size={20} strokeWidth={1.8} />
                    <span>Ir al salón</span>
                  </NavLink>
                </>
              ) : null}
            </>
          ) : (
            <>
              <span className="barra-lateral-rotulo">Espacio de trabajo</span>
              <SidebarLink
                item={{ to: '/', label: 'Dashboard', icon: House, end: true }}
                onNavigate={navigateFromSidebar}
              />
              {showBooking ? renderGroup('operations', 'Agenda y clientes', CalendarDays, [
                { to: '/agenda', label: 'Agenda', icon: CalendarDays },
                { to: '/clientes', label: 'Clientes', icon: UsersRound },
              ]) : null}
              {showBooking ? renderGroup('salon', 'Equipo y servicios', BriefcaseBusiness, [
                { to: '/servicios', label: 'Servicios', icon: CheckCircle },
                { to: '/profesionales', label: 'Profesionales', icon: UsersRound },
              ]) : null}
              {showProducts ? (
                renderGroup('store', 'Gestión de tienda', ShoppingCart, [
                  { to: '/productos', label: 'Productos', icon: Package },
                  { to: '/pedidos', label: 'Pedidos', icon: CreditCard },
                ])
              ) : null}
              {showBooking || showProducts ? renderGroup('finance', 'Finanzas', CreditCard, [
                { to: '/finanzas', label: 'Ingresos', icon: CreditCard },
              ]) : null}

              {me?.hasSalon ? (
                <>
                  <span className="barra-lateral-rotulo barra-lateral-rotulo-secundario">Administración</span>
                  <SidebarLink item={{ to: '/ajustes', label: 'Ajustes del salón', icon: Settings }}
                    onNavigate={navigateFromSidebar} />
                </>
              ) : null}

              <span className="barra-lateral-rotulo barra-lateral-rotulo-secundario">Ayuda</span>
              <SidebarLink item={{ to: '/faqs', label: 'Preguntas frecuentes', icon: CircleHelp }}
                onNavigate={navigateFromSidebar} />

              {me?.platformAdmin ? (
                <>
                  <span className="barra-lateral-rotulo barra-lateral-rotulo-secundario">Plataforma</span>
                  <SidebarLink item={{ to: '/plataforma', label: 'Administrar plataforma', icon: Settings }}
                    onNavigate={navigateFromSidebar} />
                </>
              ) : null}
            </>
          )}
        </nav>
      </aside>

      <button
        type="button"
        className="barra-lateral-interruptor"
        onClick={() => setCollapsed((value) => !value)}
        aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
        aria-expanded={!collapsed}
      >
        <ChevronRight size={16} strokeWidth={1.8} />
      </button>

      <button
        type="button"
        className="barra-lateral-fondo"
        onClick={() => setMobileOpen(false)}
        aria-label="Cerrar menú"
      />

      <div className="aplicacion-principal">
        <header className="barra-superior">
          <div className="barra-superior-izquierda">
            <button
              type="button"
              className="icono-boton movil-menu"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menú"
            >
              <Menu size={20} strokeWidth={1.8} />
            </button>
            {!platform && me?.salon?.logoUrl ? (
              <img className="barra-superior-logotipo" src={me.salon.logoUrl} alt="" />
            ) : null}
          </div>

          <div className="barra-superior-acciones">
            <div className="usuario-menu" ref={userMenuRef}>
              <button
                type="button"
                className="usuario-boton"
                onClick={() => setUserMenuOpen((value) => !value)}
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
              >
                <span className="avatar">{initials}</span>
                <span className="usuario-boton-texto">
                  <strong>{name}</strong>
                  <small>{platform ? 'Plataforma' : 'Peluquería'}</small>
                </span>
                <ChevronRight size={16} strokeWidth={1.8} />
              </button>

              {userMenuOpen ? (
                <div className="usuario-desplegable" role="menu">
                  <div className="usuario-desplegable-perfil">
                    <span className="avatar avatar-grande">{initials}</span>
                    <div>
                      <strong>{name}</strong>
                      <span>{email}</span>
                    </div>
                  </div>
                  <div className="usuario-desplegable-datos">
                    <span>Rol</span>
                    <strong>{platform ? 'Plataforma' : 'Peluquería'}</strong>
                  </div>
                  {!platform && me?.hasSalon ? (
                    <NavLink
                      to="/ajustes"
                      className="usuario-desplegable-enlace"
                      role="menuitem"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <Settings size={18} strokeWidth={1.8} />
                      Ajustes
                    </NavLink>
                  ) : null}
                  <button type="button" className="usuario-desplegable-salir" role="menuitem" onClick={signOut}>
                    <LogOut size={18} strokeWidth={1.8} />
                    Cerrar sesión
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="aplicacion-contenido">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
