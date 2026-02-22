// Contract Form Page - Create/Edit contract with Phase 3 fields
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
    tenantIds: searchParams.get('tenantId') ? [searchParams.get('tenantId')] : [],
    propertyId: searchParams.get('propertyId') || '',
    startDate: '',
    durationMonths: '24',
    currentMonth: '1',
    baseRent: '',
    adjustmentIndexId: '',
    punitoryStartDay: '10',
    punitoryPercent: '0.6',
    active: true,
    observations: '',
  })
  const [errors, setErrors] = useState({})

  // Load contract data when editing
  useEffect(() => {
    if (contract) {
      setFormData({
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
        active: contract.active ?? true,
        observations: contract.observations || '',
      })
    }
  }, [contract])

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

  // Parse formatted number back to raw digits
  const parseFormattedNumber = (str) => {
    return str.replace(/\D/g, '')
  }

  const validate = () => {
    const newErrors = {}
    if (!formData.propertyId) newErrors.propertyId = 'Seleccione una propiedad'
    if (!formData.startDate) newErrors.startDate = 'Fecha de inicio es requerida'
    if (!formData.baseRent || parseFloat(formData.baseRent) <= 0) {
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
      tenantIds: formData.tenantIds,
      baseRent: parseFloat(formData.baseRent),
      durationMonths: parseInt(formData.durationMonths, 10),
      currentMonth: parseInt(formData.currentMonth, 10),
      adjustmentIndexId: formData.adjustmentIndexId || null,
      punitoryStartDay: parseInt(formData.punitoryStartDay, 10),
      punitoryPercent: parseFloat(formData.punitoryPercent) / 100,
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

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate('/contracts')} className="mb-4">
          <ArrowLeftIcon className="w-4 h-4" />
          Volver
        </Button>
        <h1 className="text-3xl font-bold">{isEditing ? 'Editar Contrato' : 'Nuevo Contrato'}</h1>
        <p className="text-base-content/60 mt-1">{currentGroup?.name}</p>
      </div>

      {/* Form */}
      <Card>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Partes del contrato */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Partes del Contrato</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <h2 className="text-xl font-semibold">Período del Contrato</h2>

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
                helperText="En qué mes del contrato está actualmente"
              />
            </div>
          </div>

          {/* Montos */}
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

          {/* Ajustes */}
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
                  <span className="label-text">Contrato Activo</span>
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
              placeholder="Notas adicionales sobre el contrato..."
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
              {isEditing ? 'Actualizar' : 'Crear'} Contrato
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
