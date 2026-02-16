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

  const [formData, setFormData] = useState({ name: '', dni: '', phone: '', email: '', bankName: '', bankHolder: '', bankCuit: '', bankAccountType: '', bankAccountNumber: '', bankCbu: '', bankAlias: '' })
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (owner) {
      setFormData({
        name: owner.name || '',
        dni: owner.dni || '',
        phone: owner.phone || '',
        email: owner.email || '',
        bankName: owner.bankName || '',
        bankHolder: owner.bankHolder || '',
        bankCuit: owner.bankCuit || '',
        bankAccountType: owner.bankAccountType || '',
        bankAccountNumber: owner.bankAccountNumber || '',
        bankCbu: owner.bankCbu || '',
        bankAlias: owner.bankAlias || '',
      })
    }
  }, [owner])

  const handleChange = (e) => {
    const { name, value } = e.target
    let processed = value

    // Filter/format specific fields
    if (name === 'bankCbu') {
      processed = value.replace(/\D/g, '').slice(0, 22)
    } else if (name === 'bankAccountNumber') {
      processed = value.replace(/\D/g, '')
    } else if (name === 'dni') {
      processed = value.replace(/[^0-9-]/g, '')
    } else if (name === 'bankCuit') {
      // Auto-format XX-XXXXXXXX-X
      const digits = value.replace(/\D/g, '').slice(0, 11)
      if (digits.length > 10) processed = `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
      else if (digits.length > 2) processed = `${digits.slice(0, 2)}-${digits.slice(2)}`
      else processed = digits
    }

    setFormData({ ...formData, [name]: processed })
    if (errors[name]) setErrors({ ...errors, [name]: '' })
  }

  const validate = () => {
    const newErrors = {}
    if (!formData.name || formData.name.trim().length < 2) newErrors.name = 'Nombre requerido'
    if (!formData.dni || formData.dni.replace(/-/g, '').length < 7) newErrors.dni = 'DNI requerido (mín. 7 dígitos)'
    if (!formData.phone || formData.phone.trim().length < 6) newErrors.phone = 'Teléfono requerido'
    if (formData.bankCbu && formData.bankCbu.length !== 22) newErrors.bankCbu = 'El CBU debe tener 22 dígitos'
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) newErrors.email = 'Email inválido'
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
              <Input label="DNI / CUIT *" name="dni" value={formData.dni} onChange={handleChange} placeholder="20-12345678-9 o 12345678" error={errors.dni} />
              <PhoneInput label="Teléfono *" name="phone" value={formData.phone} onChange={handleChange} error={errors.phone} />
              <Input label="Email" name="email" type="email" value={formData.email} onChange={handleChange} placeholder="maria@email.com" error={errors.email} />
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Datos Bancarios</h2>
            <p className="text-sm text-base-content/50">Se usan en reportes de impuestos y liquidaciones para indicar datos de transferencia.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input label="Banco" name="bankName" value={formData.bankName} onChange={handleChange} placeholder="Banco Nacion" />
              <Input label="Titular" name="bankHolder" value={formData.bankHolder} onChange={handleChange} placeholder="Nombre del titular" />
              <Input label="CUIT Titular" name="bankCuit" value={formData.bankCuit} onChange={handleChange} placeholder="20-12345678-9" maxLength={13} />
              <div className="form-control w-full">
                <label className="label"><span className="label-text font-medium">Tipo de Cuenta</span></label>
                <select name="bankAccountType" className="select select-bordered w-full" value={formData.bankAccountType} onChange={handleChange}>
                  <option value="">Seleccionar...</option>
                  <option value="Caja de Ahorro">Caja de Ahorro</option>
                  <option value="Cuenta Corriente">Cuenta Corriente</option>
                </select>
              </div>
              <Input label="N° de Cuenta" name="bankAccountNumber" value={formData.bankAccountNumber} onChange={handleChange} placeholder="1234567890" inputMode="numeric" />
              <Input label="CBU" name="bankCbu" value={formData.bankCbu} onChange={handleChange} placeholder="0000000000000000000000" inputMode="numeric" maxLength={22} error={errors.bankCbu} />
              <Input label="Alias" name="bankAlias" value={formData.bankAlias} onChange={handleChange} placeholder="mi.alias.bancario" />
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
