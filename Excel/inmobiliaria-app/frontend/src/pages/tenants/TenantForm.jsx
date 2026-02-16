// Tenant Form Page - Create/Edit tenant
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useTenants } from '../../hooks/useTenants'
import Input from '../../components/ui/Input'
import PhoneInput from '../../components/ui/PhoneInput'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'

const MAX_GUARANTORS = 5

const emptyGuarantor = () => ({ name: '', dni: '', phone: '', email: '', address: '', observations: '' })

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
    observations: '',
  })
  const [guarantors, setGuarantors] = useState([])
  const [errors, setErrors] = useState({})

  // Load tenant data when editing
  useEffect(() => {
    if (tenant) {
      setFormData({
        name: tenant.name || '',
        dni: tenant.dni || '',
        phone: tenant.phone || '',
        email: tenant.email || '',
        observations: tenant.observations || '',
      })
      if (tenant.guarantors?.length > 0) {
        setGuarantors(tenant.guarantors.map(g => ({
          name: g.name || '',
          dni: g.dni || '',
          phone: g.phone || '',
          email: g.email || '',
          address: g.address || '',
          observations: g.observations || '',
        })))
      } else {
        setGuarantors([])
      }
    }
  }, [tenant])

  const handleChange = (e) => {
    const { name, value } = e.target
    let processed = value
    if (name === 'dni') {
      processed = value.replace(/[^0-9-]/g, '')
    }
    setFormData({ ...formData, [name]: processed })
    if (errors[name]) {
      setErrors({ ...errors, [name]: '' })
    }
  }

  const handleGuarantorChange = (index, field, value) => {
    const updated = [...guarantors]
    const processed = field === 'dni' ? value.replace(/[^0-9-]/g, '') : value
    updated[index] = { ...updated[index], [field]: processed }
    setGuarantors(updated)
    // Clear guarantor-specific errors
    if (errors[`guarantor_${index}_${field}`]) {
      const newErrors = { ...errors }
      delete newErrors[`guarantor_${index}_${field}`]
      setErrors(newErrors)
    }
  }

  const addGuarantor = () => {
    if (guarantors.length < MAX_GUARANTORS) {
      setGuarantors([...guarantors, emptyGuarantor()])
    }
  }

  const removeGuarantor = (index) => {
    setGuarantors(guarantors.filter((_, i) => i !== index))
  }

  const validate = () => {
    const newErrors = {}
    if (!formData.name || formData.name.trim().length < 2) {
      newErrors.name = 'Nombre es requerido (mín. 2 caracteres)'
    }
    if (!formData.dni || formData.dni.trim().length < 7) {
      newErrors.dni = 'DNI es requerido (mín. 7 dígitos)'
    }
    // Validate each guarantor that has any data filled
    guarantors.forEach((g, idx) => {
      if (!g.name || g.name.trim().length < 2) {
        newErrors[`guarantor_${idx}_name`] = 'Nombre del garante es requerido'
      }
      if (!g.dni || g.dni.trim().length < 7) {
        newErrors[`guarantor_${idx}_dni`] = 'DNI del garante es requerido (mín. 7 dígitos)'
      }
    })
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validate()) return

    const payload = {
      ...formData,
      guarantors: guarantors.filter(g => g.name && g.dni),
    }

    if (isEditing) {
      updateTenant(
        { id, ...payload },
        { onSuccess: () => navigate('/tenants') }
      )
    } else {
      createTenant(payload, {
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
                placeholder="20-12345678-9 o 12345678"
                error={errors.dni}
              />
              <PhoneInput
                label="Teléfono"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
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

          {/* Garantes (hasta 5) */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Garantes ({guarantors.length}/{MAX_GUARANTORS})</h2>
              {guarantors.length < MAX_GUARANTORS && (
                <Button type="button" variant="outline" size="sm" onClick={addGuarantor}>
                  <PlusIcon className="w-4 h-4" />
                  Agregar Garante
                </Button>
              )}
            </div>

            {guarantors.length === 0 && (
              <div className="text-base-content/50 text-sm border border-dashed border-base-300 rounded-lg p-4 text-center">
                No hay garantes cargados. Puede agregar hasta {MAX_GUARANTORS} garantes.
              </div>
            )}

            {guarantors.map((g, idx) => (
              <div key={idx} className="border border-base-300 rounded-lg p-4 space-y-3 relative">
                <div className="flex justify-between items-center">
                  <h3 className="font-medium text-base-content/80">Garante {idx + 1}</h3>
                  <button
                    type="button"
                    onClick={() => removeGuarantor(idx)}
                    className="btn btn-sm btn-ghost text-error"
                    title="Eliminar garante"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Nombre Completo *"
                    value={g.name}
                    onChange={(e) => handleGuarantorChange(idx, 'name', e.target.value)}
                    placeholder="María Gómez"
                    error={errors[`guarantor_${idx}_name`]}
                  />
                  <Input
                    label="DNI / CUIT *"
                    value={g.dni}
                    onChange={(e) => handleGuarantorChange(idx, 'dni', e.target.value)}
                    placeholder="11111111"
                    error={errors[`guarantor_${idx}_dni`]}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <PhoneInput
                    label="Teléfono"
                    value={g.phone}
                    onChange={(val) => handleGuarantorChange(idx, 'phone', typeof val === 'string' ? val : val?.target?.value || '')}
                  />
                  <Input
                    label="Email"
                    type="email"
                    value={g.email}
                    onChange={(e) => handleGuarantorChange(idx, 'email', e.target.value)}
                    placeholder="garante@email.com"
                  />
                  <Input
                    label="Domicilio"
                    value={g.address}
                    onChange={(e) => handleGuarantorChange(idx, 'address', e.target.value)}
                    placeholder="Av. Corrientes 1234"
                  />
                </div>
              </div>
            ))}
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
