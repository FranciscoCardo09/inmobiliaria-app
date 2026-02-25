// Main App Component with Routes
import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, lazy, Suspense } from 'react'
import { useAuthStore } from './stores/authStore'
import { authAPI } from './services/api'

// Layout
import Layout from './components/layout/Layout'

// Loading
import { LoadingPage } from './components/ui/Loading'

// Public pages (eager — needed immediately)
import Login from './pages/Login'
import Register from './pages/Register'
import AcceptInvite from './pages/AcceptInvite'
import AuthCallback from './pages/AuthCallback'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import VerifyEmail from './pages/VerifyEmail'

// Protected pages (lazy — loaded on demand)
const Dashboard = lazy(() => import('./pages/Dashboard'))
const PropertyList = lazy(() => import('./pages/properties/PropertyList'))
const PropertyForm = lazy(() => import('./pages/properties/PropertyForm'))
const OwnerList = lazy(() => import('./pages/owners/OwnerList'))
const OwnerForm = lazy(() => import('./pages/owners/OwnerForm'))
const TenantList = lazy(() => import('./pages/tenants/TenantList'))
const TenantForm = lazy(() => import('./pages/tenants/TenantForm'))
const ContractList = lazy(() => import('./pages/contracts/ContractList'))
const ContractForm = lazy(() => import('./pages/contracts/ContractForm'))
const AdjustmentIndexList = lazy(() => import('./pages/adjustments/AdjustmentIndexList').then(m => ({ default: m.AdjustmentIndexList })))
const AdjustmentIndexForm = lazy(() => import('./pages/adjustments/AdjustmentIndexForm'))
const ContractsWithAdjustments = lazy(() => import('./pages/dashboard/ContractsWithAdjustments'))
const ContractsExpiring = lazy(() => import('./pages/dashboard/ContractsExpiring'))
const MonthlyControlPage = lazy(() => import('./pages/monthly-control/MonthlyControlPage'))
const PaymentHistoryList = lazy(() => import('./pages/payment-history/PaymentHistoryList'))
const ServiceTypeList = lazy(() => import('./pages/services/ServiceTypeList'))
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage'))
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'))

function App() {
  const { isAuthenticated, setLoading, isLoading, setUser, setGroups, setPendingInvites } = useAuthStore()

  // Check auth status on mount
  useEffect(() => {
    const checkAuth = async () => {
      if (isAuthenticated) {
        try {
          const response = await authAPI.me()
          const data = response.data.data
          setUser(data.user)
          setGroups(data.groups)
          setPendingInvites(data.pendingInvites)
        } catch (error) {
          console.error('Auth check failed:', error)
        }
      }
      setLoading(false)
    }

    checkAuth()
  }, [isAuthenticated, setUser, setGroups, setPendingInvites, setLoading])

  if (isLoading) {
    return <LoadingPage />
  }

  return (
    <Suspense fallback={<LoadingPage />}>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />

        {/* Email verification & Password reset */}
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Google OAuth Callback */}
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Protected routes */}
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="dashboard/contracts-adjustments" element={<ContractsWithAdjustments />} />
          <Route path="dashboard/contracts-expiring" element={<ContractsExpiring />} />

          {/* Phase 2: Properties */}
          <Route path="properties" element={<PropertyList />} />
          <Route path="properties/new" element={<PropertyForm />} />
          <Route path="properties/:id" element={<PropertyForm />} />

          {/* Phase 3: Owners */}
          <Route path="owners" element={<OwnerList />} />
          <Route path="owners/new" element={<OwnerForm />} />
          <Route path="owners/:id" element={<OwnerForm />} />

          {/* Phase 3: Tenants */}
          <Route path="tenants" element={<TenantList />} />
          <Route path="tenants/new" element={<TenantForm />} />
          <Route path="tenants/:id" element={<TenantForm />} />

          {/* Phase 3: Contracts */}
          <Route path="contracts" element={<ContractList />} />
          <Route path="contracts/new" element={<ContractForm />} />
          <Route path="contracts/:id" element={<ContractForm />} />

          {/* Phase 3: Adjustment Indices */}
          <Route path="adjustments" element={<AdjustmentIndexList />} />
          <Route path="adjustments/new" element={<AdjustmentIndexForm />} />
          <Route path="adjustments/:id" element={<AdjustmentIndexForm />} />

          {/* Phase 5: Monthly Control + Debts */}
          <Route path="monthly-control" element={<MonthlyControlPage />} />
          <Route path="debts" element={<Navigate to="/monthly-control" replace />} />
          <Route path="payment-history" element={<PaymentHistoryList />} />
          <Route path="services" element={<ServiceTypeList />} />

          {/* Phase 6: Reports */}
          <Route path="reports" element={<ReportsPage />} />

          {/* Phase 7: Settings */}
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        {/* 404 */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
