// Main App Component with Routes
import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from './stores/authStore'
import { authAPI } from './services/api'

// Layout
import Layout from './components/layout/Layout'

// Pages
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import AcceptInvite from './pages/AcceptInvite'
import AuthCallback from './pages/AuthCallback'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import VerifyEmail from './pages/VerifyEmail'
import PropertyList from './pages/properties/PropertyList'
import PropertyForm from './pages/properties/PropertyForm'
import OwnerList from './pages/owners/OwnerList'
import OwnerForm from './pages/owners/OwnerForm'
import TenantList from './pages/tenants/TenantList'
import TenantForm from './pages/tenants/TenantForm'
import ContractList from './pages/contracts/ContractList'
import ContractForm from './pages/contracts/ContractForm'
import { AdjustmentIndexList } from './pages/adjustments/AdjustmentIndexList'
import AdjustmentIndexForm from './pages/adjustments/AdjustmentIndexForm'
import ContractsWithAdjustments from './pages/dashboard/ContractsWithAdjustments'
import ContractsExpiring from './pages/dashboard/ContractsExpiring'

// Phase 5: Monthly Control + Debts
import MonthlyControlPage from './pages/monthly-control/MonthlyControlPage'
import PaymentHistoryList from './pages/payment-history/PaymentHistoryList'
import ServiceTypeList from './pages/services/ServiceTypeList'

// Phase 6: Reports
import ReportsPage from './pages/reports/ReportsPage'

// Phase 7: Settings
import SettingsPage from './pages/settings/SettingsPage'

// Loading
import { LoadingPage } from './components/ui/Loading'

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
  )
}

export default App
