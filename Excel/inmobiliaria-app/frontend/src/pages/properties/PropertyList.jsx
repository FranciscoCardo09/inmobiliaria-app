// Property List Page - Table with filters and search
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  PlusIcon, 
  MagnifyingGlassIcon, 
  FunnelIcon,
  PencilIcon,
  TrashIcon,
  TagIcon
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useProperties } from '../../hooks/useProperties'
import { useCategories } from '../../hooks/useCategories'
import Button from '../../components/ui/Button'
import CategoryManager from '../../components/CategoryManager'
import EmptyState from '../../components/ui/EmptyState'

export const PropertyList = () => {
  const navigate = useNavigate()
  const { groups, currentGroupId } = useAuthStore()
  const currentGroup = groups.find(g => g.id === currentGroupId) || groups[0]

  const [filters, setFilters] = useState({
    search: '',
    categoryId: '',
    isActive: true,
  })
  const [showCategoryManager, setShowCategoryManager] = useState(false)

  const { properties, isLoading, deleteProperty, isDeleting } = useProperties(currentGroup?.id, filters)
  const { categories } = useCategories(currentGroup?.id)

  const handleDelete = (id) => {
    if (confirm('¿Eliminar esta propiedad?')) {
      deleteProperty(id)
    }
  }

  const getCategoryColor = (color) => {
    const colors = {
      blue: 'badge-info',
      green: 'badge-success',
      orange: 'badge-warning',
      red: 'badge-error',
      purple: 'badge-secondary',
      yellow: 'badge-warning',
      pink: 'badge-accent',
      gray: 'badge-neutral',
    }
    return colors[color] || 'badge-neutral'
  }

  if (!currentGroup) {
    return (
      <div className="p-8">
        <EmptyState
          title="No tienes grupos"
          description="Necesitas pertenecer a un grupo para gestionar propiedades"
        />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Propiedades</h1>
          <p className="text-base-content/60 mt-1">{currentGroup.name}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowCategoryManager(true)}>
            <TagIcon className="w-4 h-4" />
            Categorías
          </Button>
          <Button variant="primary" onClick={() => navigate('/properties/new')}>
            <PlusIcon className="w-4 h-4" />
            Nueva Propiedad
          </Button>
        </div>
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
                  placeholder="Buscar por dirección..."
                  className="input input-bordered w-full pl-10"
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                />
              </div>
            </div>

            {/* Category filter */}
            <select
              className="select select-bordered min-w-[180px]"
              value={filters.categoryId}
              onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
            >
              <option value="">Todas las categorías</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>

            {/* Status filter */}
            <select
              className="select select-bordered"
              value={filters.isActive}
              onChange={(e) => setFilters({ ...filters, isActive: e.target.value === 'true' })}
            >
              <option value="true">Activas</option>
              <option value="false">Inactivas</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : properties.length === 0 ? (
        <EmptyState
          title="No hay propiedades"
          description="Crea tu primera propiedad para comenzar"
          action={{
            label: 'Nueva Propiedad',
            onClick: () => navigate('/properties/new'),
          }}
        />
      ) : (
        <div className="card bg-base-100 shadow overflow-x-auto">
          <table className="table table-zebra">
            <thead>
              <tr>
                <th>Dirección</th>
                <th>Categoría</th>
                <th>m²</th>
                <th>Hab.</th>
                <th>Baños</th>
                <th>Piso/Apto</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((property) => (
                <tr key={property.id} className="hover">
                  <td>
                    <div className="font-semibold">{property.address}</div>
                    {property.observations && (
                      <div className="text-sm text-base-content/60 truncate max-w-xs">
                        {property.observations}
                      </div>
                    )}
                  </td>
                  <td>
                    {property.category ? (
                      <span className={`badge ${getCategoryColor(property.category.color)}`}>
                        {property.category.name}
                      </span>
                    ) : (
                      <span className="text-base-content/50">-</span>
                    )}
                  </td>
                  <td>{property.squareMeters ? `${property.squareMeters} m²` : '-'}</td>
                  <td>{property.rooms ?? '-'}</td>
                  <td>{property.bathrooms ?? '-'}</td>
                  <td>
                    {property.floor && property.apartment 
                      ? `${property.floor}° ${property.apartment}`
                      : property.floor || '-'}
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <button
                        onClick={() => navigate(`/properties/${property.id}`)}
                        className="btn btn-sm btn-ghost"
                      >
                        <PencilIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(property.id)}
                        className="btn btn-sm btn-ghost text-error"
                        disabled={isDeleting}
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
          <div className="stat-title">Total Propiedades</div>
          <div className="stat-value">{properties.length}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Categorías</div>
          <div className="stat-value">{categories.length}</div>
        </div>
      </div>

      {/* Category Manager Modal */}
      <CategoryManager
        isOpen={showCategoryManager}
        onClose={() => setShowCategoryManager(false)}
        groupId={currentGroup.id}
      />
    </div>
  )
}

export default PropertyList
