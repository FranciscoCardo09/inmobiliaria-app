// Dashboard Page - Phase 4 (Cards + Tablas de Pagos)
import { useNavigate } from 'react-router-dom'
import {
  BuildingOfficeIcon,
  UserGroupIcon,
  CalendarIcon,
  ExclamationTriangleIcon,
  ChevronRightIcon,
  ClipboardDocumentListIcon,
  PlusIcon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../stores/authStore'
import { useDashboard } from '../hooks/useDashboard'
import { usePayments } from '../hooks/usePayments'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import GroupCreator from '../components/GroupCreator'
import InviteUser from '../components/InviteUser'
import PendingInvites from '../components/PendingInvites'
import { LoadingPage } from '../components/ui/Loading'

// Format number to compact form: 150000 → "150k", 31500 → "31.5k"
const formatK = (n) => {
  if (!n || n === 0) return '-'
  if (Math.abs(n) >= 1000) {
    const k = (n / 1000).toFixed(1)
    return `$${k.replace('.0', '')}k`
  }
  return `$${n.toLocaleString('es-AR')}`
}

// Status badge with emoji
const StatusBadge = ({ status }) => {
  const config = {
    COMPLETE: { label: 'Pagado', cls: 'badge-success' },
    PARTIAL: { label: 'Parcial', cls: 'badge-warning' },
    PENDING: { label: 'Pendiente', cls: 'badge-error' },
  }
  const c = config[status] || config.PENDING
  return <span className={`badge ${c.cls} badge-sm`}>{c.label}</span>
}

// Get current month/year label
const getMonthLabel = (offset = 0) => {
  const d = new Date()
  d.setMonth(d.getMonth() + offset)
  return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
}

// Stats card component with optional click
const StatCard = ({ icon: Icon, label, value, color = 'primary', onClick }) => {
  const colors = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    error: 'bg-error/10 text-error',
    info: 'bg-info/10 text-info',
  }

  return (
    <Card compact className={onClick ? 'cursor-pointer hover:shadow-lg transition-shadow' : ''}>
      <div className="flex items-center gap-4" onClick={onClick}>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colors[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <p className="text-sm text-base-content/60">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        {onClick && (
          <div className="text-base-content/30">
            <ChevronRightIcon className="w-5 h-5" />
          </div>
        )}
      </div>
    </Card>
  )
}

// Payment table component
const PaymentTable = ({ payments, isProjection, onRowClick }) => {
  if (!payments || payments.length === 0) {
    return (
      <div className="text-center py-6 text-base-content/60">
        <CurrencyDollarIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p>No hay pagos para mostrar</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="table table-compact w-full">
        <thead>
          <tr className="text-xs">
            <th>Inquilino</th>
            <th>Prop</th>
            <th className="text-center">Mes</th>
            <th className="text-right">Alq</th>
            <th className="text-right">IVA</th>
            <th className="text-right">Pun</th>
            <th className="text-right">Exp</th>
            <th className="text-right font-bold">Total</th>
            <th className="text-center">Estado</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p, i) => (
            <tr
              key={p.contractId + '-' + i}
              className={onRowClick ? 'cursor-pointer hover:bg-base-200' : ''}
              onClick={() => onRowClick?.(p)}
            >
              <td className="font-medium text-sm">{p.tenant?.name}</td>
              <td className="text-sm text-base-content/70">{p.property?.code || '-'}</td>
              <td className="text-center text-sm">{p.monthNumber}</td>
              <td className="text-right text-sm">{formatK(p.alquiler)}</td>
              <td className="text-right text-sm">{formatK(p.iva)}</td>
              <td className="text-right text-sm">{formatK(p.punitorios)}</td>
              <td className="text-right text-sm">{formatK(p.expensas + (p.municipal || 0))}</td>
              <td className="text-right text-sm font-bold">{formatK(p.totalDue)}</td>
              <td className="text-center">
                <StatusBadge status={p.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const Dashboard = () => {
  const navigate = useNavigate()
  const { user, groups, currentGroupId } = useAuthStore()
  const currentGroup = groups.find((g) => g.id === currentGroupId)
  const { summary, isLoading } = useDashboard(currentGroup?.id)
  const {
    currentMonthPayments,
    nextMonthPayments,
    isLoadingCurrentMonth,
    isLoadingNextMonth,
  } = usePayments(currentGroup?.id)

  const handleCurrentRowClick = (p) => {
    if (p.paymentId) {
      navigate(`/payments/${p.paymentId}`)
    } else {
      navigate(`/payments/new?contractId=${p.contractId}`)
    }
  }

  const handleNextRowClick = (p) => {
    navigate(`/payments/new?contractId=${p.contractId}`)
  }

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
        isLoading ? (
          <div className="flex justify-center py-12">
            <span className="loading loading-spinner loading-lg text-primary"></span>
          </div>
        ) : (
          <>
            {/* Stats Grid - Row 1: Entities */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <StatCard
                icon={BuildingOfficeIcon}
                label="Propiedades"
                value={summary.propertiesCount}
                color="primary"
              />
              <StatCard
                icon={UserGroupIcon}
                label="Inquilinos"
                value={summary.tenantsCount}
                color="success"
              />
              <StatCard
                icon={ClipboardDocumentListIcon}
                label="Contratos Activos"
                value={summary.activeContracts}
                color="primary"
              />
            </div>

            {/* Stats Grid - Row 2: Alerts (clickable) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <StatCard
                icon={CalendarIcon}
                label="Contratos con Ajustes"
                value={summary.adjustmentsThisMonth + summary.adjustmentsNextMonth}
                color="warning"
                onClick={() => navigate('/dashboard/contracts-adjustments')}
              />
              <StatCard
                icon={ExclamationTriangleIcon}
                label="Contratos por Vencer"
                value={summary.contractsExpiring}
                color="error"
                onClick={() => navigate('/dashboard/contracts-expiring')}
              />
            </div>

            {/* Payment Tables */}
            <Card title={`Pagos Este Mes (${getMonthLabel()})`}>
              {isLoadingCurrentMonth ? (
                <div className="flex justify-center py-6">
                  <span className="loading loading-spinner loading-md"></span>
                </div>
              ) : (
                <PaymentTable
                  payments={currentMonthPayments}
                  onRowClick={handleCurrentRowClick}
                />
              )}
            </Card>

            <Card
              title={`Pagos Mes Que Viene (${getMonthLabel(1)})`}
              actions={
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate('/payments/new')}
                >
                  <PlusIcon className="w-4 h-4" />
                  Nuevo Pago
                </Button>
              }
            >
              {isLoadingNextMonth ? (
                <div className="flex justify-center py-6">
                  <span className="loading loading-spinner loading-md"></span>
                </div>
              ) : (
                <PaymentTable
                  payments={nextMonthPayments}
                  isProjection
                  onRowClick={handleNextRowClick}
                />
              )}
            </Card>

            {/* Group info */}
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
          </>
        )
      ) : (
        <Card className="py-12">
          <EmptyState
            icon={BuildingOfficeIcon}
            title="Selecciona un grupo"
            description="Usa el selector en el sidebar para elegir un grupo"
          />
        </Card>
      )}
    </div>
  )
}

export default Dashboard
