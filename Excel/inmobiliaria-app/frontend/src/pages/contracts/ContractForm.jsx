// Contract Form Page - Create/Edit contract with Phase 3 fields + contractType
import { useState, useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useContracts } from '../../hooks/useContracts'
import { useTenants } from '../../hooks/useTenants'
import { useProperties } from '../../hooks/useProperties'
import { useAdjustmentIndices } from '../../hooks/useAdjustmentIndices'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import DateInput from '../../components/ui/DateInput'
import SearchableSelect from '../../components/ui/SearchableSelect'
import MultiSearchableSelect from '../../components/ui/MultiSearchableSelect'

export const ContractForm = () => {
  const navigate = useNavigate()
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const isEditing = !!id

  const { groups, currentGroupId } = useAuthStore()
  const currentGroup = groups.find(g => g.id === currentGroupId) || groups[0]

  const { createContract, updateContract, isCreating, isUpdating, useContract } = useContracts(currentGroup?.id)
  const { tenants } = useTenants(currentGroup?.id, { isActive: true })
  const { properties } = useProperties(currentGroup?.id, { isActive: true })
  const { indices } = useAdjustmentIndices(currentGroup?.id)
  const { data: contract, isLoading: isLoadingContract } = isEditing ? useContract(id) : { data: null, isLoading: false }

  const [formData, setFormData] = useState({
    contractType: searchParams.get('contractType') || 'INQUILINO',
    tenantIds: searchParams.get('tenantId') ? [searchParams.get('tenantId')] : [],
    propertyId: searchParams.get('propertyId') || '',
    startDate: '',
    durationMonths: '24',
    currentMonth: '1',
    baseRent: '',
    adjustmentIndexId: '',
    punitoryStartDay: '10',
    punitoryPercent: '0.6',
    pagaIva: false,
    active: true,
    observations: '',
  })
  const [errors, setErrors] = useState({})

  const isPropietario = formData.contractType === 'PROPIETARIO'

  // Load contract data when editing
  useEffect(() => {
    if (contract) {
      setFormData({
        contractType: contract.contractType || 'INQUILINO',
        tenantIds: contract.contractTenants?.length > 0
          ? contract.contractTenants.map((ct) => ct.tenantId || ct.tenant?.id).filter(Boolean)
          : contract.tenantId ? [contract.tenantId] : [],
        propertyId: contract.propertyId || '',
        startDate: contract.startDate ? contract.startDate.split('T')[0] : '',
        durationMonths: contract.durationMonths?.toString() || '24',
        currentMonth: contract.currentMonth?.toString() || '1',
        baseRent: contract.baseRent?.toString() || '',
        baseRentDisplay: contract.baseRent ? contract.baseRent.toLocaleString('es-AR', { minimumFractionDigits: contract.baseRent % 1 !== 0 ? 2 : 0, maximumFractionDigits: 2 }) : '',
        adjustmentIndexId: contract.adjustmentIndexId || '',
        punitoryStartDay: contract.punitoryStartDay?.toString() || '10',
        punitoryPercent: contract.punitoryPercent ? (contract.punitoryPercent * 100).toString() : '0.6',
        pagaIva: contract.pagaIva ?? false,
        active: contract.active ?? true,
        observations: contract.observations || '',
      })
    }
  }, [contract])

  // Auto-check pagaIva when property category is LOCAL or LOCAL COMERCIAL
  useEffect(() => {
    if (isEditing) return // Don't auto-change when editing
    if (isPropietario) return // Don't auto-change for PROPIETARIO
    const selected = properties.find(p => p.id === formData.propertyId)
    if (selected?.category?.name === 'LOCAL COMERCIAL' || selected?.category?.name === 'LOCAL') {
      setFormData(prev => ({ ...prev, pagaIva: true }))
    } else {
      setFormData(prev => ({ ...prev, pagaIva: false }))
    }
  }, [formData.propertyId, properties, isEditing, isPropietario])

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    let newValue = type === 'checkbox' ? checked : value

    // Format baseRent: only digits, display with thousand separators
    if (name === 'baseRent') {
      newValue = value.replace(/\D/g, '')
    }

    setFormData({ ...formData, [name]: newValue })
    if (errors[name]) {
      setErrors({ ...errors, [name]: '' })
    }
  }

  // Format number with thousand separators for display
  const formatNumber = (num) => {
    if (!num) return ''
    return Number(num).toLocaleString('es-AR')
  }

  const validate = () => {
    const newErrors = {}
    if (!formData.propertyId) newErrors.propertyId = 'Seleccione una propiedad'
    if (!formData.startDate) newErrors.startDate = 'Fecha de inicio es requerida'
    // baseRent is only required for INQUILINO
    if (!isPropietario && (!formData.baseRent || parseFloat(formData.baseRent) <= 0)) {
      newErrors.baseRent = 'Monto de alquiler es requerido'
    }
    if (!formData.durationMonths || parseInt(formData.durationMonths, 10) <= 0) {
      newErrors.durationMonths = 'Duración es requerida'
    }
    if (!formData.currentMonth || parseInt(formData.currentMonth, 10) <= 0) {
      newErrors.currentMonth = 'Mes actual es requerido'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validate()) return

    const data = {
      ...formData,
      contractType: formData.contractType,
      tenantIds: isPropietario ? [] : formData.tenantIds,
      baseRent: isPropietario ? 0 : parseFloat(formData.baseRent),
      durationMonths: parseInt(formData.durationMonths, 10),
      currentMonth: parseInt(formData.currentMonth, 10),
      adjustmentIndexId: isPropietario ? null : (formData.adjustmentIndexId || null),
      punitoryStartDay: parseInt(formData.punitoryStartDay, 10),
      punitoryPercent: parseFloat(formData.punitoryPercent) / 100,
      pagaIva: formData.pagaIva,
    }

    if (isEditing) {
      updateContract(
        { id, ...data },
        { onSuccess: () => navigate('/contracts') }
      )
    } else {
      createContract(data, {
        onSuccess: () => navigate('/contracts'),
      })
    }
  }

  if (isLoadingContract) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    )
  }

  const title = isPropietario
    ? (isEditing ? 'Editar Obligación de Propietario' : 'Nueva Obligación de Propietario')
    : (isEditing ? 'Editar Contrato' : 'Nuevo Contrato')

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate('/contracts')} className="mb-4">
          <ArrowLeftIcon className="w-4 h-4" />
          Volver
        </Button>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-base-content/60 mt-1">{currentGroup?.name}</p>
      </div>

      {/* Form */}
      <Card>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Contract Type Selector */}
          {!isEditing && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Tipo de Contrato</h2>
              <div className="flex gap-4">
                <label className={`flex-1 cursor-pointer border-2 rounded-lg p-4 transition-colors ${!isPropietario ? 'border-primary bg-primary/5' : 'border-base-300'}`}>
                  <input
                    type="radio"
                    name="contractType"
                    value="INQUILINO"
                    checked={!isPropietario}
                    onChange={handleChange}
                    className="radio radio-primary radio-sm mr-2"
                  />
                  <span className="font-medium">Contrato de Inquilino</span>
                  <p className="text-xs text-base-content/60 mt-1 ml-6">
                    Contrato de alquiler con monto mensual, ajustes y seguimiento de pagos
                  </p>
                </label>
                <label className={`flex-1 cursor-pointer border-2 rounded-lg p-4 transition-colors ${isPropietario ? 'border-secondary bg-secondary/5' : 'border-base-300'}`}>
                  <input
                    type="radio"
                    name="contractType"
                    value="PROPIETARIO"
                    checked={isPropietario}
                    onChange={handleChange}
                    className="radio radio-secondary radio-sm mr-2"
                  />
                  <span className="font-medium">Obligación de Propietario</span>
                  <p className="text-xs text-base-content/60 mt-1 ml-6">
                    Seguimiento de servicios que paga el dueño (expensas, impuestos, etc.)
                  </p>
                </label>
              </div>
            </div>
          )}

          {/* Type badge when editing */}
          {isEditing && (
            <div className="flex items-center gap-2">
              <span className={`badge ${isPropietario ? 'badge-secondary' : 'badge-primary'}`}>
                {isPropietario ? 'Obligación de Propietario' : 'Contrato de Inquilino'}
              </span>
            </div>
          )}

          {/* Partes del contrato */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">
              {isPropietario ? 'Propiedad' : 'Partes del Contrato'}
            </h2>

            <div className={`grid grid-cols-1 ${isPropietario ? '' : 'md:grid-cols-2'} gap-4`}>
              {!isPropietario && (
                <MultiSearchableSelect
                  label="Inquilinos (opcional)"
                  options={tenants.map((t) => ({
                    value: t.id,
                    label: `${t.name} - DNI: ${t.dni}`,
                  }))}
                  value={formData.tenantIds}
                  onChange={(ids) => setFormData({ ...formData, tenantIds: ids })}
                  placeholder="Buscar inquilinos..."
                  disabled={isEditing}
                />
              )}

              <SearchableSelect
                label="Propiedad *"
                name="propertyId"
                options={properties.map((p) => ({
                  value: p.id,
                  label: p.address,
                }))}
                value={formData.propertyId}
                onChange={handleChange}
                placeholder="Buscar propiedad..."
                error={errors.propertyId}
                disabled={isEditing}
              />
            </div>
          </div>

          {/* Período */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Período</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="form-control w-full">
                <label className="label">
                  <span className="label-text font-medium">Fecha Inicio *</span>
                </label>
                <DateInput
                  value={formData.startDate}
                  onChange={(val) => {
                    setFormData({ ...formData, startDate: val })
                    if (errors.startDate) setErrors({ ...errors, startDate: '' })
                  }}
                />
                {errors.startDate && (
                  <label className="label">
                    <span className="label-text-alt text-error">{errors.startDate}</span>
                  </label>
                )}
              </div>
              <Input
                label="Duración Total (meses) *"
                name="durationMonths"
                type="number"
                min="1"
                value={formData.durationMonths}
                onChange={handleChange}
                placeholder="24"
                error={errors.durationMonths}
              />
              <Input
                label="Mes Actual (1 a duración) *"
                name="currentMonth"
                type="number"
                min="1"
                max={formData.durationMonths}
                value={formData.currentMonth}
                onChange={handleChange}
                placeholder="1"
                error={errors.currentMonth}
                helperText={isPropietario
                  ? '¿En qué mes de la obligación se encuentra hoy?'
                  : '¿En qué mes del contrato se encuentra hoy? (Para contratos nuevos, dejar en 1)'}
              />
            </div>
          </div>

          {/* Montos - only for INQUILINO */}
          {!isPropietario && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Condiciones Económicas</h2>

              <div className="form-control w-full">
                <label className="label">
                  <span className="label-text font-medium">Alquiler Mensual Base *</span>
                </label>
                <label className="input input-bordered flex items-center gap-2">
                  <span className="text-base-content/60">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    name="baseRent"
                    className="grow bg-transparent outline-none"
                    value={formData.baseRentDisplay ?? (formData.baseRent ? formatNumber(formData.baseRent) : '')}
                    onChange={(e) => {
                      const display = e.target.value.replace(/[^\d.,]/g, '')
                      // Parse: remove dots (thousands), replace comma with dot (decimal)
                      const raw = display.replace(/\./g, '').replace(',', '.')
                      setFormData({ ...formData, baseRent: raw, baseRentDisplay: display })
                      if (errors.baseRent) setErrors({ ...errors, baseRent: '' })
                    }}
                    onBlur={() => {
                      // On blur, reformat nicely
                      if (formData.baseRent) {
                        const num = parseFloat(formData.baseRent)
                        if (!isNaN(num)) {
                          const formatted = num.toLocaleString('es-AR', { minimumFractionDigits: num % 1 !== 0 ? 2 : 0, maximumFractionDigits: 2 })
                          setFormData((prev) => ({ ...prev, baseRentDisplay: formatted }))
                        }
                      }
                    }}
                    placeholder="1.250.000,50"
                  />
                </label>
                {errors.baseRent && (
                  <label className="label">
                    <span className="label-text-alt text-error">{errors.baseRent}</span>
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Info box for PROPIETARIO */}
          {isPropietario && (
            <div className="alert alert-info">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              <div>
                <div className="font-medium">Obligación de Propietario</div>
                <div className="text-sm">
                  No se cobra alquiler. Los servicios (expensas, impuestos, etc.) se cargan mes a mes desde el Control Mensual.
                </div>
              </div>
            </div>
          )}

          {/* IVA */}
          <div className="form-control">
            <label className="label cursor-pointer justify-start gap-4">
              <input
                type="checkbox"
                name="pagaIva"
                className="checkbox checkbox-primary"
                checked={formData.pagaIva}
                onChange={handleChange}
              />
              <div>
                <span className="label-text font-medium">¿Paga IVA?</span>
                <p className="text-xs text-base-content/60">
                  Se aplicará automáticamente 21% de IVA en cada nuevo mes del control mensual
                </p>
              </div>
            </label>
          </div>

          {/* Ajustes - only for INQUILINO */}
          {!isPropietario && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Índice de Ajuste</h2>

              <div className="form-control max-w-md">
                <SearchableSelect
                  label="Índice de ajuste periódico"
                  name="adjustmentIndexId"
                  options={(indices || []).map((idx) => ({
                    value: idx.id,
                    label: `${idx.name} (cada ${idx.frequencyMonths} ${idx.frequencyMonths === 1 ? 'mes' : 'meses'})`,
                  }))}
                  value={formData.adjustmentIndexId}
                  onChange={handleChange}
                  placeholder="Sin ajuste automático"
                />
                <label className="label">
                  <span className="label-text-alt text-base-content/60">
                    El sistema calculará automáticamente el próximo mes de ajuste
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Punitorios */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Punitorios por Pago Tardío</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Día desde donde cuentan punitorios"
                name="punitoryStartDay"
                type="number"
                min="1"
                max="28"
                value={formData.punitoryStartDay}
                onChange={handleChange}
                placeholder="10"
                helperText="Después de este día del mes se aplican recargos"
              />
              <div className="form-control w-full">
                <label className="label">
                  <span className="label-text font-medium">Porcentaje diario punitorio</span>
                </label>
                <label className="input input-bordered flex items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="punitoryPercent"
                    className="grow bg-transparent outline-none"
                    value={formData.punitoryPercent}
                    onChange={handleChange}
                    placeholder="0.6"
                  />
                  <span className="text-base-content/60">%</span>
                </label>
                <label className="label">
                  <span className="label-text-alt text-base-content/60">Ej: 0.6 = 0.6% por día de atraso</span>
                </label>
              </div>
            </div>
          </div>

          {/* Estado (solo en edición) */}
          {isEditing && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Estado</h2>
              <div className="form-control">
                <label className="label cursor-pointer justify-start gap-4">
                  <input
                    type="checkbox"
                    name="active"
                    className="checkbox checkbox-primary"
                    checked={formData.active}
                    onChange={handleChange}
                  />
                  <span className="label-text">{isPropietario ? 'Obligación Activa' : 'Contrato Activo'}</span>
                </label>
              </div>
            </div>
          )}

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
              placeholder="Notas adicionales..."
            />
          </div>

          {/* Actions */}
          <div className="flex gap-4">
            <Button
              type="submit"
              variant="primary"
              className="flex-1"
              loading={isCreating || isUpdating}
            >
              {isEditing ? 'Actualizar' : 'Crear'} {isPropietario ? 'Obligación' : 'Contrato'}
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate('/contracts')}>
              Cancelar
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

export default ContractForm
