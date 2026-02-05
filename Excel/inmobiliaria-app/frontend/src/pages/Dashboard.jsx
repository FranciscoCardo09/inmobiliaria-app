// Dashboard Page
import {
  BuildingOfficeIcon,
  UserGroupIcon,
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  ArrowTrendingUpIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../stores/authStore'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import GroupCreator from '../components/GroupCreator'
import InviteUser from '../components/InviteUser'
import PendingInvites from '../components/PendingInvites'

// Stats card component
const StatCard = ({ icon: Icon, label, value, change, color = 'primary' }) => {
  const colors = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    error: 'bg-error/10 text-error',
  }

  return (
    <Card compact>
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colors[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <p className="text-sm text-base-content/60">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        {change && (
          <div className="flex items-center gap-1 text-sm text-success">
            <ArrowTrendingUpIcon className="w-4 h-4" />
            {change}
          </div>
        )}
      </div>
    </Card>
  )
}

export const Dashboard = () => {
  const { user, groups, currentGroupId } = useAuthStore()
  const currentGroup = groups.find((g) => g.id === currentGroupId)

  return (
    <div className="space-y-6">
      {/* Welcome section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            Hola, {user?.name?.split(' ')[0]}!
          </h1>
          <p className="text-base-content/60">
            {currentGroup
              ? `Trabajando en ${currentGroup.name}`
              : 'Bienvenido al sistema de gestion inmobiliaria'}
          </p>
        </div>
        <div className="flex gap-2">
          <GroupCreator />
          <InviteUser />
        </div>
      </div>

      {/* Pending invites */}
      <PendingInvites />

      {/* Check if user has groups */}
      {groups.length === 0 ? (
        <Card className="py-12">
          <EmptyState
            icon={BuildingOfficeIcon}
            title="No tienes grupos"
            description="Crea tu primer grupo para comenzar a gestionar propiedades"
            action={<GroupCreator />}
          />
        </Card>
      ) : currentGroup ? (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={BuildingOfficeIcon}
              label="Propiedades"
              value="0"
              color="primary"
            />
            <StatCard
              icon={UserGroupIcon}
              label="Inquilinos"
              value="0"
              color="success"
            />
            <StatCard
              icon={CurrencyDollarIcon}
              label="Ingresos Mes"
              value="$0"
              color="primary"
            />
            <StatCard
              icon={ExclamationTriangleIcon}
              label="Deudas"
              value="$0"
              color="warning"
            />
          </div>

          {/* Main content area */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Recent activity */}
            <Card title="Actividad Reciente" className="lg:col-span-2">
              <EmptyState
                title="Sin actividad"
                description="Las acciones recientes apareceran aqui"
              />
            </Card>

            {/* Quick actions / Group info */}
            <Card title="Informacion del Grupo">
              <div className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b border-base-200">
                  <span className="text-base-content/60">Nombre</span>
                  <span className="font-medium">{currentGroup.name}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-base-200">
                  <span className="text-base-content/60">Tu Rol</span>
                  <span className="badge badge-primary">{currentGroup.role}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-base-200">
                  <span className="text-base-content/60">Moneda</span>
                  <span className="font-medium">{currentGroup.currency || 'ARS'}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-base-content/60">Miembros</span>
                  <span className="font-medium">{currentGroup.memberCount || '-'}</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Upcoming / Alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Pagos Pendientes">
              <EmptyState
                icon={CurrencyDollarIcon}
                title="Sin pagos pendientes"
                description="Los pagos del mes actual apareceran aqui"
              />
            </Card>

            <Card title="Contratos por Vencer">
              <EmptyState
                icon={ExclamationTriangleIcon}
                title="Sin alertas"
                description="Los contratos proximos a vencer apareceran aqui"
              />
            </Card>
          </div>
        </>
      ) : (
        <Card className="py-12">
          <EmptyState
            icon={BuildingOfficeIcon}
            title="Selecciona un grupo"
            description="Usa el selector en el sidebar para elegir un grupo"
          />
        </Card>
      )}

      {/* Phase indicator */}
      <div className="alert alert-info">
        <div>
          <h3 className="font-bold">Fase 1 Completada</h3>
          <p className="text-sm">
            Setup + Autenticacion + Grupos. Las siguientes fases agregaran
            Propiedades, Inquilinos, Pagos, Deudas y Reportes.
          </p>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
