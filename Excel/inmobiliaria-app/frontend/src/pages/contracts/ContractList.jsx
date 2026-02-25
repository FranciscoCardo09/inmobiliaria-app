// Contract List Page - Table with filters, alerts, and search
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PlusIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useContracts } from '../../hooks/useContracts'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import ContractAlerts from '../../components/ContractAlerts'

export const ContractList = () => {
  const navigate = useNavigate()
  const { groups, currentGroupId } = useAuthStore()
  const currentGroup = groups.find(g => g.id === currentGroupId)

  const [filters, setFilters] = useState({
    search: '',
    status: '',
  })
  const [confirmDelete, setConfirmDelete] = useState(null)

  const { contracts, isLoading, deleteContract, isDeleting } = useContracts(currentGroup?.id, filters)

  const handleDelete = async () => {
    if (!confirmDelete) return
    try {
      await deleteContract(confirmDelete.id)
    } catch { /* toast handles error */ }
    setConfirmDelete(null)
  }

  const getStatusBadge = (contract) => {
    if (contract.status === 'ACTIVE' && contract.isExpiringSoon) {
      return <span className="badge badge-warning badge-sm gap-1">
        <ExclamationTriangleIcon className="w-3 h-3" />
        Por vencer
      </span>
    }
    const statusMap = {
      ACTIVE: { class: 'badge-success', label: 'Activo' },
      EXPIRED: { class: 'badge-error', label: 'Vencido' },
      TERMINATED: { class: 'badge-ghost', label: 'Rescindido' },
      RENEWED: { class: 'badge-info', label: 'Renovado' },
    }
    const s = statusMap[contract.status] || { class: 'badge-ghost', label: contract.status }
    return <span className={`badge badge-sm ${s.class}`}>{s.label}</span>
  }

  if (!currentGroup) {
    return (
      <div className="p-8">
        <EmptyState
          title="No tienes grupos"
          description="Necesitas pertenecer a un grupo para gestionar contratos"
        />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Alerts Banner */}
      <ContractAlerts groupId={currentGroup.id} />

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Contratos</h1>
          <p className="text-base-content/60 mt-1">{currentGroup.name}</p>
        </div>
        <Button variant="primary" onClick={() => navigate('/contracts/new')}>
          <PlusIcon className="w-4 h-4" />
          Nuevo Contrato
        </Button>
      </div>

      {/* Filters */}
      <div className="card bg-base-100 shadow">
        <div className="card-body p-4">
          <div className="flex flex-wrap gap-4">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/50" />
                <input
                  type="text"
                  placeholder="Buscar por inquilino, propiedad..."
                  className="input input-bordered w-full pl-10"
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                />
              </div>
            </div>

            {/* Status filter */}
            <select
              className="select select-bordered"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">Todos los contratos</option>
              <option value="ACTIVE">Activos</option>
              <option value="INACTIVE">Inactivos</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : contracts.length === 0 ? (
        <EmptyState
          title="No hay contratos"
          description="Crea tu primer contrato para comenzar"
          action={{
            label: 'Nuevo Contrato',
            onClick: () => navigate('/contracts/new'),
          }}
        />
      ) : (
        <div className="card bg-base-100 shadow overflow-x-auto">
          <table className="table table-zebra">
            <thead>
              <tr>
                <th>Inquilino</th>
                <th>Propiedad</th>
                <th>Inicio</th>
                <th>Fin</th>
                <th>Mes</th>
                <th>Monto</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((contract) => (
                <tr key={contract.id} className={`hover ${contract.isExpiringSoon ? 'bg-warning/10' : ''}`}>
                  <td>
                    <div className="font-semibold">
                      {contract.tenants?.length > 0
                        ? contract.tenants.map((t) => t.name).join(' / ')
                        : contract.tenant?.name || 'Sin inquilino'}
                    </div>
                    {(contract.tenants?.[0]?.dni || contract.tenant?.dni) && (
                      <div className="text-xs text-base-content/60">DNI: {contract.tenants?.[0]?.dni || contract.tenant?.dni}</div>
                    )}
                  </td>
                  <td>
                    <div className="text-sm">{contract.property?.address}</div>
                  </td>
                  <td>{new Date(contract.startDate).toLocaleDateString('es-AR')}</td>
                  <td>{new Date(contract.endDate).toLocaleDateString('es-AR')}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <ClockIcon className="w-3 h-3" />
                      <span className="font-mono text-sm">
                        {contract.currentMonth}/{contract.durationMonths}
                      </span>
                    </div>
                    <progress
                      className={`progress w-16 h-1 ${contract.isExpiringSoon ? 'progress-warning' : 'progress-primary'}`}
                      value={contract.currentMonth}
                      max={contract.durationMonths}
                    />
                  </td>
                  <td className="font-semibold">
                    ${Math.round(contract.rentAmount || 0).toLocaleString('es-AR')}
                  </td>
                  <td>{getStatusBadge(contract)}</td>
                  <td>
                    <div className="flex gap-1">
                      <button
                        onClick={() => navigate(`/contracts/${contract.id}`)}
                        className="btn btn-sm btn-ghost"
                        title="Editar"
                      >
                        <PencilIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(contract)}
                        className="btn btn-sm btn-ghost text-error"
                        title="Eliminar"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Stats */}
      <div className="stats shadow">
        <div className="stat">
          <div className="stat-title">Total Contratos</div>
          <div className="stat-value">{contracts.length}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Activos</div>
          <div className="stat-value text-success">
            {contracts.filter((c) => c.status === 'ACTIVE').length}
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Por Vencer</div>
          <div className="stat-value text-warning">
            {contracts.filter((c) => c.isExpiringSoon).length}
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg text-error">Eliminar Contrato</h3>
            <p className="py-4">
              ¿Estás seguro de eliminar el contrato de{' '}
              <span className="font-semibold">
                {confirmDelete.tenants?.length > 0
                  ? confirmDelete.tenants.map((t) => t.name).join(' / ')
                  : confirmDelete.tenant?.name || 'Sin inquilino'}
              </span>{' '}
              en <span className="font-semibold">{confirmDelete.property?.address}</span>?
            </p>
            <p className="text-sm text-base-content/60">
              Se eliminarán todos los registros mensuales, pagos y transacciones asociados. Esta acción no se puede deshacer.
            </p>
            <div className="modal-action">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmDelete(null)}
                disabled={isDeleting}
              >
                Cancelar
              </button>
              <button
                className="btn btn-error btn-sm"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? <span className="loading loading-spinner loading-xs" /> : <TrashIcon className="w-4 h-4" />}
                Eliminar
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => !isDeleting && setConfirmDelete(null)} />
        </div>
      )}
    </div>
  )
}

export default ContractList
