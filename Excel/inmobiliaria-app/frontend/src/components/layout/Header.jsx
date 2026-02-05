// Header Component
import { Bars3Icon, BellIcon, UserCircleIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useUIStore } from '../../stores/uiStore'
import { useAuth } from '../../hooks/useAuth'

export const Header = () => {
  const { user, groups, currentGroupId } = useAuthStore()
  const { toggleSidebar } = useUIStore()
  const { logout } = useAuth()
  const pendingInvites = useAuthStore((state) => state.pendingInvites)

  const currentGroup = groups.find((g) => g.id === currentGroupId)

  return (
    <header className="navbar bg-base-100 border-b border-base-300 px-4 lg:px-6">
      {/* Mobile menu button */}
      <div className="flex-none lg:hidden">
        <button
          onClick={toggleSidebar}
          className="btn btn-square btn-ghost"
        >
          <Bars3Icon className="w-6 h-6" />
        </button>
      </div>

      {/* Title / Current Group */}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-primary hidden sm:inline">
            Inmobiliaria
          </span>
          {currentGroup && (
            <>
              <span className="text-base-content/40 hidden sm:inline">/</span>
              <span className="font-medium">{currentGroup.name}</span>
              <span className="badge badge-sm badge-ghost">{currentGroup.role}</span>
            </>
          )}
        </div>
      </div>

      {/* Right side */}
      <div className="flex-none flex items-center gap-2">
        {/* Notifications */}
        <div className="dropdown dropdown-end">
          <label tabIndex={0} className="btn btn-ghost btn-circle">
            <div className="indicator">
              <BellIcon className="w-6 h-6" />
              {pendingInvites.length > 0 && (
                <span className="badge badge-xs badge-primary indicator-item">
                  {pendingInvites.length}
                </span>
              )}
            </div>
          </label>
          <div
            tabIndex={0}
            className="dropdown-content z-[1] card card-compact w-80 p-2 shadow-lg bg-base-100 border border-base-300"
          >
            <div className="card-body">
              <h3 className="font-bold text-lg">Notificaciones</h3>
              {pendingInvites.length === 0 ? (
                <p className="text-sm text-base-content/60">No hay notificaciones</p>
              ) : (
                <div className="space-y-2">
                  {pendingInvites.map((invite) => (
                    <div
                      key={invite.id}
                      className="p-2 bg-base-200 rounded-lg"
                    >
                      <p className="text-sm font-medium">
                        Invitacion a {invite.groupName}
                      </p>
                      <p className="text-xs text-base-content/60">
                        Por {invite.invitedBy} como {invite.role}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* User menu */}
        <div className="dropdown dropdown-end">
          <label tabIndex={0} className="btn btn-ghost btn-circle avatar placeholder">
            {user?.avatar ? (
              <div className="w-10 rounded-full">
                <img src={user.avatar} alt={user.name} referrerPolicy="no-referrer" />
              </div>
            ) : (
              <div className="bg-primary text-primary-content rounded-full w-10">
                <span className="text-lg">
                  {user?.name?.charAt(0).toUpperCase() || 'U'}
                </span>
              </div>
            )}
          </label>
          <ul
            tabIndex={0}
            className="dropdown-content z-[1] menu p-2 shadow-lg bg-base-100 rounded-box w-52 border border-base-300"
          >
            <li className="menu-title">
              <span>{user?.name}</span>
              <span className="text-xs font-normal">{user?.email}</span>
            </li>
            <div className="divider my-1"></div>
            <li>
              <a>
                <UserCircleIcon className="w-5 h-5" />
                Mi Perfil
              </a>
            </li>
            <li>
              <button onClick={logout} className="text-error">
                Cerrar Sesion
              </button>
            </li>
          </ul>
        </div>
      </div>
    </header>
  )
}

export default Header
