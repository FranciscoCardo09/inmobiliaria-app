// AdjustmentIndex Form Page - Create/Edit adjustment index
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useAdjustmentIndices } from '../../hooks/useAdjustmentIndices'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'

export const AdjustmentIndexForm = () => {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEditing = !!id

  const { groups } = useAuthStore()
  const currentGroup = groups[0]

  const { createIndex, updateIndex, isCreating, isUpdating } = useAdjustmentIndices(currentGroup?.id)

  const [formData, setFormData] = useState({
    name: '',
    frequencyMonths: '3',
  })
  const [errors, setErrors] = useState({})

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData({ ...formData, [name]: value })
    if (errors[name]) {
      setErrors({ ...errors, [name]: '' })
    }
  }

  const validate = () => {
    const newErrors = {}
    if (!formData.name) newErrors.name = 'Nombre es requerido'
    if (!formData.frequencyMonths || parseInt(formData.frequencyMonths, 10) <= 0) {
      newErrors.frequencyMonths = 'Frecuencia es requerida'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validate()) return

    const data = {
      ...formData,
      frequencyMonths: parseInt(formData.frequencyMonths, 10),
    }

    if (isEditing) {
      updateIndex(
        { id, ...data },
        { onSuccess: () => navigate('/adjustments') }
      )
    } else {
      createIndex(data, {
        onSuccess: () => navigate('/adjustments'),
      })
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate('/adjustments')} className="mb-4">
          <ArrowLeftIcon className="w-4 h-4" />
          Volver
        </Button>
        <h1 className="text-3xl font-bold">
          {isEditing ? 'Editar Índice de Ajuste' : 'Nuevo Índice de Ajuste'}
        </h1>
        <p className="text-base-content/60 mt-1">{currentGroup?.name}</p>
      </div>

      {/* Form */}
      <Card>
        <form onSubmit={handleSubmit} className="space-y-6">
          <Input
            label="Nombre del índice *"
            name="name"
            type="text"
            value={formData.name}
            onChange={handleChange}
            placeholder="Ej: IPC Trimestral"
            error={errors.name}
            helperText="Nombre descriptivo para identificar este índice"
          />

          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">Frecuencia de ajuste *</span>
            </label>
            <select
              name="frequencyMonths"
              className={`select select-bordered w-full ${errors.frequencyMonths ? 'select-error' : ''}`}
              value={formData.frequencyMonths}
              onChange={handleChange}
            >
              <option value="1">Cada 1 mes (Mensual)</option>
              <option value="2">Cada 2 meses (Bimestral)</option>
              <option value="3">Cada 3 meses (Trimestral)</option>
              <option value="4">Cada 4 meses (Cuatrimestral)</option>
              <option value="6">Cada 6 meses (Semestral)</option>
              <option value="12">Cada 12 meses (Anual)</option>
            </select>
            {errors.frequencyMonths && (
              <label className="label">
                <span className="label-text-alt text-error">{errors.frequencyMonths}</span>
              </label>
            )}
            <label className="label">
              <span className="label-text-alt text-base-content/60">
                Los contratos asociados se ajustarán según esta frecuencia
              </span>
            </label>
          </div>

          {/* Info box */}
          <div className="alert alert-info">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              className="stroke-current shrink-0 w-6 h-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              ></path>
            </svg>
            <div className="text-sm">
              <p className="font-semibold">¿Cómo funciona?</p>
              <p className="mt-1">
                Los contratos con este índice se ajustarán automáticamente cada {formData.frequencyMonths}{' '}
                {formData.frequencyMonths === '1' ? 'mes' : 'meses'}. El sistema te alertará cuando un
                contrato tenga ajuste este mes o el próximo.
              </p>
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
              {isEditing ? 'Actualizar' : 'Crear'} Índice
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate('/adjustments')}>
              Cancelar
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

export default AdjustmentIndexForm
