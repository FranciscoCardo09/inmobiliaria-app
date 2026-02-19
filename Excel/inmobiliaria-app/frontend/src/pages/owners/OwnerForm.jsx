// Owner Form Page - Create/Edit owner
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useOwners } from '../../hooks/useOwners'
import Input from '../../components/ui/Input'
import PhoneInput from '../../components/ui/PhoneInput'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'

// Helper: split semicolon-delimited values into array, filter empty
const splitMulti = (val) => (val || '').split(';').map(v => v.trim()).filter(Boolean)
// Helper: join array into semicolon-delimited string
const joinMulti = (arr) => arr.filter(Boolean).join('; ')

export const OwnerForm = () => {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEditing = !!id

  const { groups, currentGroupId } = useAuthStore()
  const currentGroup = groups.find(g => g.id === currentGroupId) || groups[0]
  const { createOwner, updateOwner, isCreating, isUpdating, useOwner } = useOwners(currentGroup?.id)
  const { data: owner, isLoading } = isEditing ? useOwner(id) : { data: null, isLoading: false }

  const [formData, setFormData] = useState({
    name: '', dni: '',
    phones: [''], emails: [''],
    bankName: '', bankHolder: '', bankCuit: '', bankAccountType: '', bankAccountNumber: '', bankCbu: '', bankAlias: ''
  })
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (owner) {
      setFormData({
        name: owner.name || '',
        dni: owner.dni || '',
        phones: splitMulti(owner.phone).length > 0 ? splitMulti(owner.phone) : [''],
        emails: splitMulti(owner.email).length > 0 ? splitMulti(owner.email) : [''],
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

    if (name === 'bankCbu') {
      processed = value.replace(/\D/g, '').slice(0, 22)
    } else if (name === 'bankAccountNumber') {
      processed = value.replace(/\D/g, '')
    } else if (name === 'dni') {
      processed = value.replace(/[^0-9-]/g, '')
    } else if (name === 'bankCuit') {
      const digits = value.replace(/\D/g, '').slice(0, 11)
      if (digits.length > 10) processed = `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
      else if (digits.length > 2) processed = `${digits.slice(0, 2)}-${digits.slice(2)}`
      else processed = digits
    }

    setFormData({ ...formData, [name]: processed })
    if (errors[name]) setErrors({ ...errors, [name]: '' })
  }

  // Multi-value handlers
  const handlePhoneChange = (index, e) => {
    const val = typeof e === 'string' ? e : e?.target?.value || ''
    const updated = [...formData.phones]
    updated[index] = val
    setFormData({ ...formData, phones: updated })
  }

  const addPhone = () => setFormData({ ...formData, phones: [...formData.phones, ''] })
  const removePhone = (index) => {
    const updated = formData.phones.filter((_, i) => i !== index)
    setFormData({ ...formData, phones: updated.length > 0 ? updated : [''] })
  }

  const handleEmailChange = (index, value) => {
    const updated = [...formData.emails]
    updated[index] = value
    setFormData({ ...formData, emails: updated })
  }

  const addEmail = () => setFormData({ ...formData, emails: [...formData.emails, ''] })
  const removeEmail = (index) => {
    const updated = formData.emails.filter((_, i) => i !== index)
    setFormData({ ...formData, emails: updated.length > 0 ? updated : [''] })
  }

  const validate = () => {
    const newErrors = {}
    if (!formData.name || formData.name.trim().length < 2) newErrors.name = 'Nombre requerido'
    if (!formData.dni || formData.dni.replace(/-/g, '').length < 7) newErrors.dni = 'DNI requerido (mín. 7 dígitos)'
    const validPhones = formData.phones.filter(p => p.trim().length > 0)
    if (validPhones.length === 0 || validPhones[0].trim().length < 6) newErrors.phone = 'Al menos un teléfono es requerido'
    if (formData.bankCbu && formData.bankCbu.length !== 22) newErrors.bankCbu = 'El CBU debe tener 22 dígitos'
    const validEmails = formData.emails.filter(e => e.trim().length > 0)
    for (const em of validEmails) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { newErrors.email = 'Email inválido'; break }
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validate()) return

    const payload = {
      name: formData.name,
      dni: formData.dni,
      phone: joinMulti(formData.phones),
      email: joinMulti(formData.emails),
      bankName: formData.bankName,
      bankHolder: formData.bankHolder,
      bankCuit: formData.bankCuit,
      bankAccountType: formData.bankAccountType,
      bankAccountNumber: formData.bankAccountNumber,
      bankCbu: formData.bankCbu,
      bankAlias: formData.bankAlias,
    }

    if (isEditing) {
      updateOwner({ id, ...payload }, { onSuccess: () => navigate('/owners') })
    } else {
      createOwner(payload, { onSuccess: () => navigate('/owners') })
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
            <Input label="DNI / CUIT *" name="dni" value={formData.dni} onChange={handleChange} placeholder="20-12345678-9 o 12345678" error={errors.dni} />

            {/* Multiple phones */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="label-text font-medium">Teléfonos *</label>
                <button type="button" className="btn btn-ghost btn-xs" onClick={addPhone}>
                  <PlusIcon className="w-3 h-3" /> Agregar
                </button>
              </div>
              {formData.phones.map((phone, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <div className="flex-1">
                    <PhoneInput
                      name={`phone_${idx}`}
                      value={phone}
                      onChange={(e) => handlePhoneChange(idx, e)}
                      error={idx === 0 ? errors.phone : undefined}
                    />
                  </div>
                  {formData.phones.length > 1 && (
                    <button type="button" className="btn btn-ghost btn-sm text-error mt-1" onClick={() => removePhone(idx)}>
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Multiple emails */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="label-text font-medium">Emails</label>
                <button type="button" className="btn btn-ghost btn-xs" onClick={addEmail}>
                  <PlusIcon className="w-3 h-3" /> Agregar
                </button>
              </div>
              {formData.emails.map((email, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <div className="flex-1">
                    <Input
                      name={`email_${idx}`}
                      type="email"
                      value={email}
                      onChange={(e) => handleEmailChange(idx, e.target.value)}
                      placeholder="maria@email.com"
                      error={idx === 0 ? errors.email : undefined}
                    />
                  </div>
                  {formData.emails.length > 1 && (
                    <button type="button" className="btn btn-ghost btn-sm text-error mt-1" onClick={() => removeEmail(idx)}>
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
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
