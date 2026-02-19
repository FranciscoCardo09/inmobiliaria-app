// Owner List Page
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PlusIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  TrashIcon,
  PhoneIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useOwners } from '../../hooks/useOwners'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'

export const OwnerList = () => {
  const navigate = useNavigate()
  const { groups, currentGroupId } = useAuthStore()
  const currentGroup = groups.find(g => g.id === currentGroupId) || groups[0]

  const [filters, setFilters] = useState({ search: '' })
  const { owners, isLoading, deleteOwner, isDeleting } = useOwners(currentGroup?.id, filters)

  const handleDelete = (id) => {
    if (confirm('¿Eliminar este dueño?')) {
      deleteOwner(id)
    }
  }

  if (!currentGroup) {
    return (
      <div className="p-8">
        <EmptyState title="No tienes grupos" description="Necesitas pertenecer a un grupo" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Dueños</h1>
          <p className="text-base-content/60 mt-1">{currentGroup.name}</p>
        </div>
        <Button variant="primary" onClick={() => navigate('/owners/new')}>
          <PlusIcon className="w-4 h-4" />
          Nuevo Dueño
        </Button>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body p-4">
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
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : owners.length === 0 ? (
        <EmptyState
          title="No hay dueños"
          description="Crea tu primer dueño de propiedad para comenzar"
          action={{ label: 'Nuevo Dueño', onClick: () => navigate('/owners/new') }}
        />
      ) : (
        <div className="card bg-base-100 shadow overflow-x-auto">
          <table className="table table-zebra">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>DNI</th>
                <th>Teléfono</th>
                <th>Email</th>
                <th>Propiedades</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {owners.map((owner) => (
                <tr key={owner.id} className="hover">
                  <td className="font-semibold">{owner.name}</td>
                  <td><span className="badge badge-ghost">{owner.dni}</span></td>
                  <td>
                    <div className="flex items-center gap-1">
                      <PhoneIcon className="w-3 h-3" />
                      {owner.phone}
                    </div>
                  </td>
                  <td>{owner.email || '-'}</td>
                  <td><span className="badge badge-outline">{owner._count?.properties || 0}</span></td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => navigate(`/owners/${owner.id}`)} className="btn btn-sm btn-ghost">
                        <PencilIcon className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(owner.id)} className="btn btn-sm btn-ghost text-error" disabled={isDeleting}>
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

      <div className="stats shadow">
        <div className="stat">
          <div className="stat-title">Total Dueños</div>
          <div className="stat-value">{owners.length}</div>
        </div>
      </div>
    </div>
  )
}

export default OwnerList
