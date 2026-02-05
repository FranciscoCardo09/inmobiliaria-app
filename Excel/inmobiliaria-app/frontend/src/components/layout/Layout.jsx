// Main Layout Component
import { Outlet, Navigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { LoadingPage } from '../ui/Loading'
import Header from './Header'
import Sidebar from './Sidebar'

export const Layout = () => {
  const { isAuthenticated, isLoading } = useAuthStore()

  if (isLoading) {
    return <LoadingPage />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="min-h-screen bg-base-200 flex">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen lg:ml-0">
        {/* Header */}
        <Header />

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default Layout
