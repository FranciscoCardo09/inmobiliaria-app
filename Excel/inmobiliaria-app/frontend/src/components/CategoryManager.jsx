// Category Manager - Modal to manage categories
import { useState } from 'react'
import { PlusIcon, PencilIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Input from './ui/Input'
import { useCategories } from '../hooks/useCategories'

const COLORS = [
  { value: 'blue', label: 'Azul', class: 'bg-blue-500' },
  { value: 'green', label: 'Verde', class: 'bg-green-500' },
  { value: 'orange', label: 'Naranja', class: 'bg-orange-500' },
  { value: 'red', label: 'Rojo', class: 'bg-red-500' },
  { value: 'purple', label: 'Púrpura', class: 'bg-purple-500' },
  { value: 'yellow', label: 'Amarillo', class: 'bg-yellow-500' },
  { value: 'pink', label: 'Rosa', class: 'bg-pink-500' },
  { value: 'gray', label: 'Gris', class: 'bg-gray-500' },
]

export const CategoryManager = ({ isOpen, onClose, groupId }) => {
  const { categories, isLoading, createCategory, updateCategory, deleteCategory, isCreating, isDeleting } =
    useCategories(groupId)

  const [formData, setFormData] = useState({
    name: '',
    color: 'blue',
    description: '',
  })
  const [editingId, setEditingId] = useState(null)
  const [errors, setErrors] = useState({})

  const resetForm = () => {
    setFormData({ name: '', color: 'blue', description: '' })
    setEditingId(null)
    setErrors({})
  }

  const handleSubmit = (e) => {
    e.preventDefault()

    // Validation
    const newErrors = {}
    if (!formData.name || formData.name.trim().length < 2) {
      newErrors.name = 'Mínimo 2 caracteres'
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    if (editingId) {
      updateCategory(
        { id: editingId, ...formData },
        {
          onSuccess: () => resetForm(),
        }
      )
    } else {
      createCategory(formData, {
        onSuccess: () => resetForm(),
      })
    }
  }

  const handleEdit = (category) => {
    setFormData({
      name: category.name,
      color: category.color || 'blue',
      description: category.description || '',
    })
    setEditingId(category.id)
  }

  const handleDelete = (id) => {
    if (confirm('¿Eliminar esta categoría?')) {
      deleteCategory(id)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose()
        resetForm()
      }}
      title="Gestionar Categorías"
      size="lg"
    >
      <div className="space-y-6">
        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-base-200 rounded-lg">
          <div className="flex gap-4">
            <div className="flex-1">
              <Input
                label="Nombre"
                value={formData.name}
                onChange={(e) => {
                  setFormData({ ...formData, name: e.target.value.toUpperCase() })
                  setErrors({ ...errors, name: '' })
                }}
                placeholder="VARIOS, MATIENZO, LOCAL..."
                error={errors.name}
              />
            </div>

            <div className="w-32">
              <label className="label">
                <span className="label-text">Color</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              >
                {COLORS.map((color) => (
                  <option key={color.value} value={color.value}>
                    {color.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Input
            label="Descripción (opcional)"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Descripción..."
          />

          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={isCreating} className="flex-1">
              {editingId ? 'Actualizar' : 'Crear'} Categoría
            </Button>
            {editingId && (
              <Button type="button" variant="ghost" onClick={resetForm}>
                Cancelar
              </Button>
            )}
          </div>
        </form>

        {/* List */}
        <div>
          <h3 className="font-semibold mb-3">Categorías ({categories.length})</h3>
          {isLoading ? (
            <div className="text-center py-8">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : categories.length === 0 ? (
            <div className="text-center py-8 text-base-content/50">No hay categorías</div>
          ) : (
            <div className="space-y-2">
              {categories.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center justify-between p-3 bg-base-100 rounded-lg border border-base-300"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full ${COLORS.find((c) => c.value === category.color)?.class || 'bg-gray-500'}`} />
                    <div>
                      <div className="font-semibold">{category.name}</div>
                      {category.description && (
                        <div className="text-sm text-base-content/60">{category.description}</div>
                      )}
                      <div className="text-xs text-base-content/50">{category._count.properties} propiedades</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(category)}
                      className="btn btn-sm btn-ghost"
                      disabled={editingId === category.id}
                    >
                      <PencilIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(category.id)}
                      className="btn btn-sm btn-ghost text-error"
                      disabled={isDeleting || category._count.properties > 0}
                      title={category._count.properties > 0 ? 'No se puede eliminar con propiedades asociadas' : ''}
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default CategoryManager
