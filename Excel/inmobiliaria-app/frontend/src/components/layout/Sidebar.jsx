// Sidebar Component
import { NavLink } from 'react-router-dom'
import {
  HomeIcon,
  BuildingOfficeIcon,
  UserGroupIcon,
  UsersIcon,
  CurrencyDollarIcon,
  DocumentTextIcon,
  ClipboardDocumentListIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  XMarkIcon,
  PlusIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useUIStore } from '../../stores/uiStore'

const navItems = [
  { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
  { name: 'Propiedades', href: '/properties', icon: BuildingOfficeIcon, phase: 2 },
  { name: 'Dueños', href: '/owners', icon: UsersIcon, phase: 3 },
  { name: 'Inquilinos', href: '/tenants', icon: UserGroupIcon, phase: 3 },
  { name: 'Contratos', href: '/contracts', icon: ClipboardDocumentListIcon, phase: 3 },
  { name: 'Índices de Ajuste', href: '/adjustments', icon: ChartBarIcon, phase: 3 },
  { name: 'Pagos', href: '/payments', icon: CurrencyDollarIcon, phase: 4 },
  { name: 'Reportes', href: '/reports', icon: DocumentTextIcon, phase: 6 },
]

export const Sidebar = () => {
  const { groups, currentGroupId, setCurrentGroup } = useAuthStore()
  const { sidebarOpen, closeSidebar } = useUIStore()

  const handleGroupChange = (groupId) => {
    setCurrentGroup(groupId)
  }

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-30 h-full w-64 bg-base-100 border-r border-base-300 transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:z-auto ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between p-4 border-b border-base-300">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <BuildingOfficeIcon className="w-5 h-5 text-primary-content" />
            </div>
            <span className="font-bold text-xl">Inmobiliaria</span>
          </div>
          <button
            onClick={closeSidebar}
            className="btn btn-sm btn-ghost lg:hidden"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Group selector */}
        <div className="p-4 border-b border-base-300">
          <label className="label">
            <span className="label-text text-xs uppercase tracking-wide text-base-content/60">
              Grupo Activo
            </span>
          </label>
          <select
            value={currentGroupId || ''}
            onChange={(e) => handleGroupChange(e.target.value)}
            className="select select-bordered select-sm w-full"
          >
            {groups.length === 0 ? (
              <option value="">Sin grupos</option>
            ) : (
              groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            // Phase 3 is complete, only disable phases 4+
            const isDisabled = item.phase && item.phase > 4;
            
            return (
              <NavLink
                key={item.name}
                to={item.href}
                onClick={closeSidebar}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-content'
                      : 'hover:bg-base-200 text-base-content'
                  } ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`
                }
              >
                <item.icon className="w-5 h-5" />
                <span>{item.name}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-base-300">
          <NavLink
            to="/settings"
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-base-200 transition-colors"
          >
            <Cog6ToothIcon className="w-5 h-5" />
            <span>Configuracion</span>
          </NavLink>
          <div className="mt-4 text-center">
            <p className="text-xs text-base-content/40">
              Fase 4 - v1.1.0
            </p>
          </div>
        </div>
      </aside>
    </>
  )
}

export default Sidebar
