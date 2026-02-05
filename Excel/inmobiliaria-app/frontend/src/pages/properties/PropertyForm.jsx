// Property Form Page - Create/Edit property
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useProperties } from '../../hooks/useProperties'
import { useCategories } from '../../hooks/useCategories'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'

export const PropertyForm = () => {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEditing = !!id

  const { groups } = useAuthStore()
  const currentGroup = groups[0]

  const { createProperty, updateProperty, isCreating, isUpdating, useProperty } = useProperties(currentGroup?.id)
  const { categories } = useCategories(currentGroup?.id)

  const { data: property, isLoading: isLoadingProperty } = isEditing ? useProperty(id) : { data: null, isLoading: false }

  const [formData, setFormData] = useState({
    address: '',
    code: '',
    categoryId: '',
    squareMeters: '',
    rooms: '',
    bathrooms: '',
    floor: '',
    apartment: '',
    observations: '',
  })
  const [errors, setErrors] = useState({})

  // Load property data when editing
  useEffect(() => {
    if (property) {
      setFormData({
        address: property.address || '',
        code: property.code || '',
        categoryId: property.categoryId || '',
        squareMeters: property.squareMeters || '',
        rooms: property.rooms || '',
        bathrooms: property.bathrooms || '',
        floor: property.floor || '',
        apartment: property.apartment || '',
        observations: property.observations || '',
      })
    }
  }, [property])

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData({ ...formData, [name]: value })
    if (errors[name]) {
      setErrors({ ...errors, [name]: '' })
    }
  }

  const validate = () => {
    const newErrors = {}
    if (!formData.address || formData.address.trim().length < 5) {
      newErrors.address = 'Mínimo 5 caracteres'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validate()) return

    const data = {
      ...formData,
      categoryId: formData.categoryId || null,
      squareMeters: formData.squareMeters ? parseFloat(formData.squareMeters) : null,
      rooms: formData.rooms ? parseInt(formData.rooms, 10) : null,
      bathrooms: formData.bathrooms ? parseInt(formData.bathrooms, 10) : null,
    }

    if (isEditing) {
      updateProperty(
        { id, ...data },
        {
          onSuccess: () => navigate('/properties'),
        }
      )
    } else {
      createProperty(data, {
        onSuccess: () => navigate('/properties'),
      })
    }
  }

  if (isLoadingProperty) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate('/properties')} className="mb-4">
          <ArrowLeftIcon className="w-4 h-4" />
          Volver
        </Button>
        <h1 className="text-3xl font-bold">{isEditing ? 'Editar Propiedad' : 'Nueva Propiedad'}</h1>
        <p className="text-base-content/60 mt-1">{currentGroup?.name}</p>
      </div>

      {/* Form */}
      <Card>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Información Básica</h2>

            <Input
              label="Dirección *"
              name="address"
              value={formData.address}
              onChange={handleChange}
              placeholder="Av. Corrientes 1234"
              error={errors.address}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Código"
                name="code"
                value={formData.code}
                onChange={handleChange}
                placeholder="4B, LC, etc."
              />

              <div>
                <label className="label">
                  <span className="label-text">Categoría</span>
                </label>
                <select
                  name="categoryId"
                  className="select select-bordered w-full"
                  value={formData.categoryId}
                  onChange={handleChange}
                >
                  <option value="">Sin categoría</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Detalles</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                label="Metros Cuadrados"
                name="squareMeters"
                type="number"
                step="0.01"
                value={formData.squareMeters}
                onChange={handleChange}
                placeholder="45.5"
              />

              <Input
                label="Habitaciones"
                name="rooms"
                type="number"
                value={formData.rooms}
                onChange={handleChange}
                placeholder="2"
              />

              <Input
                label="Baños"
                name="bathrooms"
                type="number"
                value={formData.bathrooms}
                onChange={handleChange}
                placeholder="1"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Piso"
                name="floor"
                value={formData.floor}
                onChange={handleChange}
                placeholder="4, PB, etc."
              />

              <Input
                label="Apartamento"
                name="apartment"
                value={formData.apartment}
                onChange={handleChange}
                placeholder="A, B, C, etc."
              />
            </div>

            <div>
              <label className="label">
                <span className="label-text">Observaciones</span>
              </label>
              <textarea
                name="observations"
                className="textarea textarea-bordered w-full h-24"
                value={formData.observations}
                onChange={handleChange}
                placeholder="Notas adicionales sobre la propiedad..."
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-4">
            <Button
              type="submit"
              variant="primary"
              className="flex-1"
              loading={isCreating || isUpdating}
            >
              {isEditing ? 'Actualizar' : 'Crear'} Propiedad
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate('/properties')}>
              Cancelar
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

export default PropertyForm
