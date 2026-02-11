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
  TableCellsIcon,
  ClockIcon,
  WrenchScrewdriverIcon,
  ExclamationTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useUIStore } from '../../stores/uiStore'

const navItems = [
  { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
  { name: 'Control Mensual', href: '/monthly-control', icon: TableCellsIcon, phase: 5 },
  { name: 'Propiedades', href: '/properties', icon: BuildingOfficeIcon, phase: 2 },
  { name: 'Dueños', href: '/owners', icon: UsersIcon, phase: 3 },
  { name: 'Inquilinos', href: '/tenants', icon: UserGroupIcon, phase: 3 },
  { name: 'Contratos', href: '/contracts', icon: ClipboardDocumentListIcon, phase: 3 },
  { name: 'Índices de Ajuste', href: '/adjustments', icon: ChartBarIcon, phase: 3 },
  { name: 'Pagos', href: '/payments', icon: CurrencyDollarIcon, phase: 4 },
  { name: 'Historial Pagos', href: '/payment-history', icon: ClockIcon, phase: 5 },
  { name: 'Servicios', href: '/services', icon: WrenchScrewdriverIcon, phase: 5 },
  { name: 'Reportes', href: '/reports', icon: DocumentTextIcon, phase: 6 },
]

export const Sidebar = () => {
  const { groups, currentGroupId, setCurrentGroup } = useAuthStore()
  const { sidebarOpen, closeSidebar, sidebarCollapsed, toggleSidebarCollapsed } = useUIStore()

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
        className={`fixed top-0 left-0 z-30 h-full bg-base-100 border-r border-base-300 transform transition-all duration-300 ease-in-out lg:translate-x-0 lg:static lg:z-auto ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${sidebarCollapsed ? 'lg:w-16' : 'lg:w-64'} w-64`}
      >
        {/* Collapse toggle button - Desktop only - Modern circular design */}
        <button
          onClick={toggleSidebarCollapsed}
          className="hidden lg:flex absolute -right-3 top-6 z-40 w-6 h-6 bg-base-100 hover:bg-base-200 text-base-content border-2 border-base-300 rounded-full items-center justify-center shadow-md transition-all duration-200 hover:scale-110 hover:shadow-lg group"
          title={sidebarCollapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
        >
          {sidebarCollapsed ? (
            <ChevronRightIcon className="w-3.5 h-3.5 group-hover:w-4 group-hover:h-4 transition-all" />
          ) : (
            <ChevronLeftIcon className="w-3.5 h-3.5 group-hover:w-4 group-hover:h-4 transition-all" />
          )}
        </button>
        {/* Logo */}
        <div className="flex items-center justify-between p-4 border-b border-base-300">
          <div className={`flex items-center gap-2 ${sidebarCollapsed ? 'lg:justify-center lg:w-full' : ''}`}>
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
              <BuildingOfficeIcon className="w-5 h-5 text-primary-content" />
            </div>
            <span className={`font-bold text-xl transition-opacity duration-200 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
              Inmobiliaria
            </span>
          </div>
          <button
            onClick={closeSidebar}
            className="btn btn-sm btn-ghost lg:hidden"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Group selector */}
        <div className={`p-4 border-b border-base-300 transition-opacity duration-200 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
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
            // Phase 6 is complete, only disable phases 7+
            const isDisabled = item.phase && item.phase > 6;

            return (
              <NavLink
                key={item.name}
                to={item.href}
                onClick={closeSidebar}
                title={sidebarCollapsed ? item.name : ''}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-content'
                      : 'hover:bg-base-200 text-base-content'
                  } ${isDisabled ? 'opacity-50 pointer-events-none' : ''} ${
                    sidebarCollapsed ? 'lg:justify-center' : ''
                  }`
                }
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                <span className={`transition-opacity duration-200 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                  {item.name}
                </span>
              </NavLink>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-base-300">
          <NavLink
            to="/settings"
            title={sidebarCollapsed ? 'Configuracion' : ''}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-base-200 transition-colors ${
              sidebarCollapsed ? 'lg:justify-center' : ''
            }`}
          >
            <Cog6ToothIcon className="w-5 h-5 flex-shrink-0" />
            <span className={`transition-opacity duration-200 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
              Configuracion
            </span>
          </NavLink>
          <div className={`mt-4 text-center transition-opacity duration-200 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
            <p className="text-xs text-base-content/40">
              Fase 6 - v3.0.0
            </p>
          </div>
        </div>
      </aside>
    </>
  )
}

export default Sidebar
