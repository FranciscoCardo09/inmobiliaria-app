// Service Manager Modal - Manage services/extras for a monthly record
import { useState } from 'react'
import { useMonthlyServices } from '../hooks/useMonthlyServices'
import { useConceptTypes } from '../hooks/usePayments'
import { useServiceCategories } from '../hooks/useServiceCategories'
import Modal from './ui/Modal'
import Button from './ui/Button'
import {
  PlusIcon,
  TrashIcon,
  WrenchScrewdriverIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline'

const formatCurrency = (amount) => {
  if (!amount && amount !== 0) return '$0'
  return `$${Math.round(amount).toLocaleString('es-AR')}`
}

// Fallback colors/labels
const fallbackLabels = {
  IMPUESTO: 'Impuesto',
  SERVICIO: 'Servicio',
  GASTO: 'Gasto',
  MANTENIMIENTO: 'Mantenimiento',
  DESCUENTO: 'Descuento',
  OTROS: 'Otros',
}

const fallbackColors = {
  IMPUESTO: 'badge-error',
  SERVICIO: 'badge-info',
  GASTO: 'badge-warning',
  MANTENIMIENTO: 'badge-accent',
  DESCUENTO: 'badge-success',
  OTROS: 'badge-ghost',
}

export default function ServiceManagerModal({ record, groupId, onClose }) {
  const { services, isLoading, addService, removeService, updateService, isAdding } =
    useMonthlyServices(groupId, record?.id)

  const { conceptTypes } = useConceptTypes(groupId)
  const { categories } = useServiceCategories(groupId)

  // Build dynamic label/color maps from categories
  const categoryLabels = {}
  const categoryColors = {}
  ;(categories || []).forEach((c) => {
    categoryLabels[c.name] = c.label
    categoryColors[c.name] = c.color
  })
  // Merge fallbacks
  Object.keys(fallbackLabels).forEach((k) => {
    if (!categoryLabels[k]) categoryLabels[k] = fallbackLabels[k]
    if (!categoryColors[k]) categoryColors[k] = fallbackColors[k]
  })

  const [selectedType, setSelectedType] = useState('')
  const [serviceAmount, setServiceAmount] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editAmount, setEditAmount] = useState('')

  // Filter out already assigned concept types
  const assignedIds = new Set(services.map((s) => s.conceptTypeId))
  const availableTypes = conceptTypes.filter((ct) => !assignedIds.has(ct.id))

  // Group available types by category
  const groupedTypes = availableTypes.reduce((acc, ct) => {
    const cat = ct.category || 'OTROS'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(ct)
    return acc
  }, {})

  const handleAdd = () => {
    if (!selectedType || !serviceAmount) return
    addService({
      conceptTypeId: selectedType,
      amount: parseFloat(serviceAmount),
    })
    setSelectedType('')
    setServiceAmount('')
  }

  const handleUpdate = (serviceId) => {
    if (!editAmount) return
    updateService({ serviceId, amount: parseFloat(editAmount) })
    setEditingId(null)
    setEditAmount('')
  }

  const total = services.reduce((sum, s) => {
    const isDiscount = s.conceptType?.category === 'DESCUENTO'
    return sum + (isDiscount ? -Math.abs(s.amount) : s.amount)
  }, 0)

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <WrenchScrewdriverIcon className="w-5 h-5" />
          Servicios / Extras
        </div>
      }
      size="md"
    >
      <div className="space-y-4">
        {/* Record Info */}
        <div className="bg-base-200 rounded-lg p-3 text-sm">
          <div className="flex justify-between">
            <span>{record?.tenant?.name} - {record?.property?.address}</span>
            <span className="font-semibold">{record?.periodLabel}</span>
          </div>
        </div>

        {/* Current Services */}
        <div>
          <h3 className="font-semibold text-sm mb-2">Servicios asignados</h3>
          {services.length === 0 ? (
            <p className="text-sm text-base-content/50 py-2">
              No hay servicios asignados para este mes
            </p>
          ) : (
            <div className="space-y-2">
              {services.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between bg-base-100 border border-base-300 rounded-lg p-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`badge badge-xs ${
                        categoryColors[s.conceptType?.category] || 'badge-ghost'
                      }`}
                    >
                      {categoryLabels[s.conceptType?.category] || s.conceptType?.category}
                    </span>
                    <span className="text-sm font-medium truncate">
                      {s.conceptType?.label || s.conceptType?.name}
                    </span>
                    {s.conceptType?.description && (
                      <div className="tooltip tooltip-right" data-tip={s.conceptType.description}>
                        <InformationCircleIcon className="w-3.5 h-3.5 text-base-content/40" />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {editingId === s.id ? (
                      <>
                        <input
                          type="number"
                          className="input input-bordered input-xs w-24"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          autoFocus
                        />
                        <button
                          className="btn btn-xs btn-success"
                          onClick={() => handleUpdate(s.id)}
                        >
                          OK
                        </button>
                        <button
                          className="btn btn-xs btn-ghost"
                          onClick={() => setEditingId(null)}
                        >
                          X
                        </button>
                      </>
                    ) : (
                      <>
                        <span
                          className="font-mono text-sm cursor-pointer hover:text-primary"
                          onClick={() => {
                            setEditingId(s.id)
                            setEditAmount(s.amount.toString())
                          }}
                        >
                          {formatCurrency(s.amount)}
                        </span>
                        <button
                          className="btn btn-xs btn-ghost text-error"
                          onClick={() => removeService(s.id)}
                        >
                          <TrashIcon className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}

              <div className="flex justify-between pt-2 border-t border-base-200 font-semibold text-sm">
                <span>Total Servicios</span>
                <span className="font-mono">{formatCurrency(total)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Add Service */}
        <div>
          <h3 className="font-semibold text-sm mb-2">Agregar servicio</h3>
          <div className="flex gap-2">
            <select
              className="select select-bordered select-sm flex-1"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
            >
              <option value="">Seleccionar tipo...</option>
              {Object.entries(groupedTypes).map(([cat, types]) => (
                <optgroup key={cat} label={categoryLabels[cat] || cat}>
                  {types.map((ct) => (
                    <option key={ct.id} value={ct.id}>
                      {ct.label} ({categoryLabels[ct.category]})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <input
              type="number"
              className="input input-bordered input-sm w-28"
              placeholder="Monto"
              value={serviceAmount}
              onChange={(e) => setServiceAmount(e.target.value)}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleAdd}
              loading={isAdding}
              disabled={!selectedType || !serviceAmount}
            >
              <PlusIcon className="w-4 h-4" />
            </Button>
          </div>
          {availableTypes.length === 0 && (
            <p className="text-xs text-base-content/50 mt-1">
              Todos los tipos de servicio ya están asignados.
              Crea nuevos desde la sección de Servicios.
            </p>
          )}
        </div>
      </div>

      <div className="modal-action">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </Modal>
  )
}
