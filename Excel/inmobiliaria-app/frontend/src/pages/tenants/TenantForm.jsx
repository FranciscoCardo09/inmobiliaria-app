// Tenant Form Page - Create/Edit tenant
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useTenants } from '../../hooks/useTenants'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'

export const TenantForm = () => {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEditing = !!id

  const { groups } = useAuthStore()
  const currentGroup = groups[0]

  const { createTenant, updateTenant, isCreating, isUpdating, useTenant } = useTenants(currentGroup?.id)
  const { data: tenant, isLoading: isLoadingTenant } = isEditing ? useTenant(id) : { data: null, isLoading: false }

  const [formData, setFormData] = useState({
    name: '',
    dni: '',
    phone: '',
    email: '',
    guarantorName: '',
    guarantorDni: '',
    guarantorPhone: '',
    observations: '',
  })
  const [errors, setErrors] = useState({})

  // Load tenant data when editing
  useEffect(() => {
    if (tenant) {
      setFormData({
        name: tenant.name || '',
        dni: tenant.dni || '',
        phone: tenant.phone || '',
        email: tenant.email || '',
        guarantorName: tenant.guarantorName || '',
        guarantorDni: tenant.guarantorDni || '',
        guarantorPhone: tenant.guarantorPhone || '',
        observations: tenant.observations || '',
      })
    }
  }, [tenant])

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData({ ...formData, [name]: value })
    if (errors[name]) {
      setErrors({ ...errors, [name]: '' })
    }
  }

  const validate = () => {
    const newErrors = {}
    if (!formData.name || formData.name.trim().length < 2) {
      newErrors.name = 'Nombre es requerido (mín. 2 caracteres)'
    }
    if (!formData.dni || formData.dni.trim().length < 7) {
      newErrors.dni = 'DNI es requerido (mín. 7 dígitos)'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validate()) return

    if (isEditing) {
      updateTenant(
        { id, ...formData },
        { onSuccess: () => navigate('/tenants') }
      )
    } else {
      createTenant(formData, {
        onSuccess: () => navigate('/tenants'),
      })
    }
  }

  if (isLoadingTenant) {
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
        <Button variant="ghost" onClick={() => navigate('/tenants')} className="mb-4">
          <ArrowLeftIcon className="w-4 h-4" />
          Volver
        </Button>
        <h1 className="text-3xl font-bold">{isEditing ? 'Editar Inquilino' : 'Nuevo Inquilino'}</h1>
        <p className="text-base-content/60 mt-1">{currentGroup?.name}</p>
      </div>

      {/* Form */}
      <Card>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Datos Personales */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Datos Personales</h2>

            <Input
              label="Nombre Completo *"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Juan Pérez"
              error={errors.name}
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                label="DNI / CUIT *"
                name="dni"
                value={formData.dni}
                onChange={handleChange}
                placeholder="12345678"
                error={errors.dni}
              />
              <Input
                label="Teléfono"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="1166666666"
              />
              <Input
                label="Email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="juan@email.com"
              />
            </div>
          </div>

          {/* Garante */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Garante</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                label="Nombre Garante"
                name="guarantorName"
                value={formData.guarantorName}
                onChange={handleChange}
                placeholder="María Gómez"
              />
              <Input
                label="DNI Garante"
                name="guarantorDni"
                value={formData.guarantorDni}
                onChange={handleChange}
                placeholder="11111111"
              />
              <Input
                label="Teléfono Garante"
                name="guarantorPhone"
                value={formData.guarantorPhone}
                onChange={handleChange}
                placeholder="1155555555"
              />
            </div>
          </div>

          {/* Observaciones */}
          <div>
            <label className="label">
              <span className="label-text">Observaciones</span>
            </label>
            <textarea
              name="observations"
              className="textarea textarea-bordered w-full h-24"
              value={formData.observations}
              onChange={handleChange}
              placeholder="Notas adicionales sobre el inquilino..."
            />
          </div>

          {/* Historial de contratos (solo en edición) */}
          {isEditing && tenant?.contracts?.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Historial de Contratos</h2>
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Propiedad</th>
                      <th>Inicio</th>
                      <th>Fin</th>
                      <th>Monto</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenant.contracts.map((contract) => (
                      <tr key={contract.id}>
                        <td>{contract.property?.address || '-'}</td>
                        <td>{new Date(contract.startDate).toLocaleDateString('es-AR')}</td>
                        <td>{new Date(contract.endDate).toLocaleDateString('es-AR')}</td>
                        <td>${contract.rentAmount?.toLocaleString('es-AR')}</td>
                        <td>
                          <span className={`badge badge-sm ${
                            contract.status === 'ACTIVE' ? 'badge-success' :
                            contract.status === 'EXPIRED' ? 'badge-error' :
                            contract.status === 'RENEWED' ? 'badge-info' :
                            'badge-ghost'
                          }`}>
                            {contract.status === 'ACTIVE' ? 'Activo' :
                             contract.status === 'EXPIRED' ? 'Vencido' :
                             contract.status === 'TERMINATED' ? 'Rescindido' :
                             contract.status === 'RENEWED' ? 'Renovado' :
                             contract.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-4">
            <Button
              type="submit"
              variant="primary"
              className="flex-1"
              loading={isCreating || isUpdating}
            >
              {isEditing ? 'Actualizar' : 'Crear'} Inquilino
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate('/tenants')}>
              Cancelar
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

export default TenantForm
