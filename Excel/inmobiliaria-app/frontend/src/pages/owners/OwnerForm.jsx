// Owner Form Page - Create/Edit owner
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useOwners } from '../../hooks/useOwners'
import Input from '../../components/ui/Input'
import PhoneInput from '../../components/ui/PhoneInput'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'

export const OwnerForm = () => {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEditing = !!id

  const { groups } = useAuthStore()
  const currentGroup = groups[0]
  const { createOwner, updateOwner, isCreating, isUpdating, useOwner } = useOwners(currentGroup?.id)
  const { data: owner, isLoading } = isEditing ? useOwner(id) : { data: null, isLoading: false }

  const [formData, setFormData] = useState({ name: '', dni: '', phone: '', email: '' })
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (owner) {
      setFormData({
        name: owner.name || '',
        dni: owner.dni || '',
        phone: owner.phone || '',
        email: owner.email || '',
      })
    }
  }, [owner])

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData({ ...formData, [name]: value })
    if (errors[name]) setErrors({ ...errors, [name]: '' })
  }

  const validate = () => {
    const newErrors = {}
    if (!formData.name || formData.name.trim().length < 2) newErrors.name = 'Nombre requerido'
    if (!formData.dni || formData.dni.trim().length < 7) newErrors.dni = 'DNI requerido (mín. 7 dígitos)'
    if (!formData.phone || formData.phone.trim().length < 6) newErrors.phone = 'Teléfono requerido'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validate()) return
    if (isEditing) {
      updateOwner({ id, ...formData }, { onSuccess: () => navigate('/owners') })
    } else {
      createOwner(formData, { onSuccess: () => navigate('/owners') })
    }
  }

  if (isLoading) {
    return <div className="flex justify-center items-center min-h-screen"><span className="loading loading-spinner loading-lg"></span></div>
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate('/owners')} className="mb-4">
          <ArrowLeftIcon className="w-4 h-4" /> Volver
        </Button>
        <h1 className="text-3xl font-bold">{isEditing ? 'Editar Dueño' : 'Nuevo Dueño'}</h1>
        <p className="text-base-content/60 mt-1">{currentGroup?.name}</p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Datos del Dueño</h2>
            <Input label="Nombre Completo *" name="name" value={formData.name} onChange={handleChange} placeholder="María García" error={errors.name} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input label="DNI / CUIT *" name="dni" value={formData.dni} onChange={handleChange} placeholder="20123456789" error={errors.dni} />
              <PhoneInput label="Teléfono *" name="phone" value={formData.phone} onChange={handleChange} error={errors.phone} />
              <Input label="Email" name="email" type="email" value={formData.email} onChange={handleChange} placeholder="maria@email.com" />
            </div>
          </div>

          {isEditing && owner?.properties?.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Propiedades</h2>
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead><tr><th>Dirección</th><th>Código</th><th>Estado</th></tr></thead>
                  <tbody>
                    {owner.properties.map((p) => (
                      <tr key={p.id}>
                        <td>{p.address}</td>
                        <td><span className="badge badge-ghost">{p.code || '-'}</span></td>
                        <td><span className={`badge badge-sm ${p.isActive ? 'badge-success' : 'badge-error'}`}>{p.isActive ? 'Activa' : 'Inactiva'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-4">
            <Button type="submit" variant="primary" className="flex-1" loading={isCreating || isUpdating}>
              {isEditing ? 'Actualizar' : 'Crear'} Dueño
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate('/owners')}>Cancelar</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

export default OwnerForm
