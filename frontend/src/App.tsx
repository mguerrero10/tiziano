import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { ModuleRoute } from './components/ModuleRoute'
import { ProtectedRoute } from './components/ProtectedRoute'
import { PlatformRoute } from './components/PlatformRoute'
import { DashboardLayout } from './layouts/DashboardLayout'
import { BOOKING_MODULES } from './lib/modules'
import { BookingPage } from './pages/BookingPage'
import { CalendarPage } from './pages/CalendarPage'
import { CustomersPage } from './pages/CustomersPage'
import { DashboardPage } from './pages/DashboardPage'
import { FaqsPage } from './pages/FaqsPage'
import { LoginPage } from './pages/LoginPage'
import { PlatformDashboardPage } from './pages/PlatformDashboardPage'
import { PlatformSalonsPage } from './pages/PlatformSalonsPage'
import { ProductsPage } from './pages/ProductsPage'
import { OrdersPage } from './pages/OrdersPage'
import { StorePage } from './pages/StorePage'
import { ServicesPage } from './pages/ServicesPage'
import { SettingsPage } from './pages/SettingsPage'
import { StaffPage } from './pages/StaffPage'
import { PaymentsPage } from './pages/PaymentsPage'
import FloatingChatButton from './components/chatbot/FloatingChatButton'

const FINANCE_MODULES = [...BOOKING_MODULES, 'products']

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <FloatingChatButton />
        <Routes>
          <Route
            path="/login"
            element={
              <div className="container">
                <LoginPage />
              </div>
            }
          />
          <Route path="/s/:slug" element={<BookingPage />} />
          <Route path="/s/:slug/tienda" element={<StorePage />} />
          <Route
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route
              path="/servicios"
              element={
                <ModuleRoute anyOf={BOOKING_MODULES}>
                  <ServicesPage />
                </ModuleRoute>
              }
            />
            <Route
              path="/profesionales"
              element={
                <ModuleRoute anyOf={BOOKING_MODULES}>
                  <StaffPage />
                </ModuleRoute>
              }
            />
            <Route
              path="/clientes"
              element={
                <ModuleRoute anyOf={BOOKING_MODULES}>
                  <CustomersPage />
                </ModuleRoute>
              }
            />

            <Route
              path="/finanzas"
              element={
                <ModuleRoute anyOf={FINANCE_MODULES}>
                  <PaymentsPage />
                </ModuleRoute>
              }
            />
            <Route path="/pagos" element={<Navigate to="/finanzas" replace />} />
            <Route
              path="/agenda"
              element={
                <ModuleRoute anyOf={BOOKING_MODULES}>
                  <CalendarPage />
                </ModuleRoute>
              }
            />
            <Route
              path="/productos"
              element={
                <ModuleRoute module="products">
                  <ProductsPage />
                </ModuleRoute>
              }
            />
            <Route path="/pedidos" element={<ModuleRoute module="products"><OrdersPage /></ModuleRoute>} />
            <Route path="/faqs" element={<FaqsPage />} />
            <Route path="/ajustes" element={<SettingsPage />} />
          </Route>
          <Route
            element={
              <PlatformRoute>
                <DashboardLayout />
              </PlatformRoute>
            }
          >
            <Route path="/plataforma" element={<PlatformDashboardPage />} />
            <Route path="/plataforma/clientes" element={<PlatformSalonsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
