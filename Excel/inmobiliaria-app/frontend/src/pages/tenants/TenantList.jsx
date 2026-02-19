// Tenant List Page - Table with filters and search
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PlusIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  TrashIcon,
  DocumentTextIcon,
  PhoneIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useTenants } from '../../hooks/useTenants'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'

export const TenantList = () => {
  const navigate = useNavigate()
  const { groups, currentGroupId } = useAuthStore()
  const currentGroup = groups.find(g => g.id === currentGroupId) || groups[0]

  const [filters, setFilters] = useState({
    search: '',
    isActive: true,
  })

  const { tenants, isLoading, deleteTenant, isDeleting } = useTenants(currentGroup?.id, filters)

  const handleDelete = (id) => {
    if (confirm('¿Eliminar este inquilino?')) {
      deleteTenant(id)
    }
  }

  if (!currentGroup) {
    return (
      <div className="p-8">
        <EmptyState
          title="No tienes grupos"
          description="Necesitas pertenecer a un grupo para gestionar inquilinos"
        />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Inquilinos</h1>
          <p className="text-base-content/60 mt-1">{currentGroup.name}</p>
        </div>
        <Button variant="primary" onClick={() => navigate('/tenants/new')}>
          <PlusIcon className="w-4 h-4" />
          Nuevo Inquilino
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
                  placeholder="Buscar por nombre, DNI, teléfono..."
                  className="input input-bordered w-full pl-10"
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                />
              </div>
            </div>

            {/* Status filter */}
            <select
              className="select select-bordered"
              value={filters.isActive}
              onChange={(e) => setFilters({ ...filters, isActive: e.target.value === 'true' })}
            >
              <option value="true">Activos</option>
              <option value="false">Inactivos</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : tenants.length === 0 ? (
        <EmptyState
          title="No hay inquilinos"
          description="Crea tu primer inquilino para comenzar"
          action={{
            label: 'Nuevo Inquilino',
            onClick: () => navigate('/tenants/new'),
          }}
        />
      ) : (
        <div className="card bg-base-100 shadow overflow-x-auto">
          <table className="table table-zebra">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>DNI</th>
                <th>Teléfono</th>
                <th>Garantes</th>
                <th>Propiedad Actual</th>
                <th>Contratos</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => {
                const activeContract = tenant.contracts?.[0]
                return (
                  <tr key={tenant.id} className="hover">
                    <td>
                      <div className="font-semibold">{tenant.name}</div>
                      {tenant.email && (
                        <div className="text-sm text-base-content/60">{tenant.email}</div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-ghost">{tenant.dni}</span>
                    </td>
                    <td>
                      {tenant.phone ? (
                        <div className="flex items-center gap-1">
                          <PhoneIcon className="w-3 h-3" />
                          {tenant.phone}
                        </div>
                      ) : '-'}
                    </td>
                    <td>
                      {tenant.guarantors?.length > 0 ? (
                        <div>
                          <div className="text-sm">{tenant.guarantors[0].name}</div>
                          {tenant.guarantors.length > 1 && (
                            <div className="text-xs text-base-content/60">
                              +{tenant.guarantors.length - 1} más
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-base-content/50">-</span>
                      )}
                    </td>
                    <td>
                      {activeContract ? (
                        <div>
                          <div className="text-sm font-medium">{activeContract.property.address}</div>
                          <span className="badge badge-success badge-sm">Contrato activo</span>
                        </div>
                      ) : (
                        <span className="badge badge-ghost badge-sm">Sin contrato</span>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-outline">{tenant._count?.contracts || 0}</span>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <button
                          onClick={() => navigate(`/tenants/${tenant.id}`)}
                          className="btn btn-sm btn-ghost"
                          title="Editar"
                        >
                          <PencilIcon className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => navigate(`/contracts/new?tenantId=${tenant.id}`)}
                          className="btn btn-sm btn-ghost text-info"
                          title="Nuevo contrato"
                        >
                          <DocumentTextIcon className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(tenant.id)}
                          className="btn btn-sm btn-ghost text-error"
                          disabled={isDeleting}
                          title="Eliminar"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Stats */}
      <div className="stats shadow">
        <div className="stat">
          <div className="stat-title">Total Inquilinos</div>
          <div className="stat-value">{tenants.length}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Con Contrato Activo</div>
          <div className="stat-value">
            {tenants.filter((t) => t.contracts?.length > 0).length}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TenantList
