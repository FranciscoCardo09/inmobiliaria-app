// PaymentForm - Phase 4 v2
// IVA manual, conceptos dinámicos con creación en el momento, botón Registrar Pago
import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { usePayments, usePaymentCalculation, useConceptTypes } from '../../hooks/usePayments'
import { useServiceCategories } from '../../hooks/useServiceCategories'
import { useContracts } from '../../hooks/useContracts'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { LoadingPage } from '../../components/ui/Loading'
import DateInput, { getLocalToday } from '../../components/ui/DateInput'

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const FALLBACK_CATEGORIES = [
  { value: 'IMPUESTO', label: 'Impuesto' },
  { value: 'SERVICIO', label: 'Servicio' },
  { value: 'GASTO', label: 'Gasto' },
  { value: 'MANTENIMIENTO', label: 'Mantenimiento' },
  { value: 'OTROS', label: 'Otros' },
]

// Mini-form to create new concept type inline
const NewConceptTypeForm = ({ onSave, onCancel, categoryOptions }) => {
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState('OTROS')
  const [description, setDescription] = useState('')

  const cats = categoryOptions && categoryOptions.length > 0 ? categoryOptions : FALLBACK_CATEGORIES

  const handleSave = () => {
    if (!name.trim() || !label.trim()) return
    onSave({ name: name.trim(), label: label.trim(), category, description: description.trim() || undefined })
    setName('')
    setLabel('')
    setCategory('OTROS')
    setDescription('')
  }

  return (
    <div className="border border-primary/30 rounded-lg p-3 bg-primary/5 space-y-2">
      <h4 className="text-sm font-semibold flex items-center gap-1">
        <PlusIcon className="w-4 h-4" /> Nuevo tipo de concepto
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          type="text"
          placeholder="Código (ej: LUZ)"
          className="input input-bordered input-sm w-full"
          value={name}
          onChange={(e) => setName(e.target.value.toUpperCase())}
        />
        <input
          type="text"
          placeholder="Nombre (ej: Luz)"
          className="input input-bordered input-sm w-full"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <select
          className="select select-bordered select-sm w-full"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {cats.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>
      <input
        type="text"
        placeholder="Descripción (opcional, para reportes)"
        className="input input-bordered input-sm w-full"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <XMarkIcon className="w-4 h-4" /> Cancelar
        </Button>
        <Button variant="primary" size="sm" onClick={handleSave} disabled={!name.trim() || !label.trim()}>
          <CheckCircleIcon className="w-4 h-4" /> Crear
        </Button>
      </div>
    </div>
  )
}

export const PaymentForm = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const { groups } = useAuthStore()
  const currentGroup = groups[0]
  const groupId = currentGroup?.id

  const { contracts, isLoading: isLoadingContracts } = useContracts(groupId)
  const { createPayment, isCreating } = usePayments(groupId)
  const { conceptTypes, createConceptType, seedDefaults, isCreating: isCreatingConcept } = useConceptTypes(groupId)
  const { categories: serviceCategories } = useServiceCategories(groupId)

  // Build category options for the NewConceptTypeForm
  const categoryOptions = useMemo(() => {
    if (!serviceCategories || serviceCategories.length === 0) return FALLBACK_CATEGORIES
    return serviceCategories
      .filter((c) => c.isActive)
      .map((c) => ({ value: c.name, label: c.label }))
  }, [serviceCategories])

  // Build category label map for display
  const categoryLabelMap = useMemo(() => {
    const map = {}
    FALLBACK_CATEGORIES.forEach((c) => { map[c.value] = c.label })
    ;(serviceCategories || []).forEach((c) => { map[c.name] = c.label })
    return map
  }, [serviceCategories])

  const [selectedContractId, setSelectedContractId] = useState(
    searchParams.get('contractId') || ''
  )
  const [paymentDate, setPaymentDate] = useState(getLocalToday())

  // Period month/year for the cuota
  const now = new Date()
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1)
  const [periodYear, setPeriodYear] = useState(now.getFullYear())

  // Manual concepts: { type: string, amount: number }[]
  const [manualConcepts, setManualConcepts] = useState([])
  const [ivaAmount, setIvaAmount] = useState('')
  const [amountPaid, setAmountPaid] = useState('')
  const [observations, setObservations] = useState('')
  const [showNewConceptForm, setShowNewConceptForm] = useState(false)

  // Calculate payment preview (alquiler + punitorios)
  const { data: calcData, isLoading: isCalculating } = usePaymentCalculation(
    groupId,
    selectedContractId,
    paymentDate
  )

  // Active contracts
  const activeContracts = useMemo(() => {
    return (contracts || []).filter((c) => c.active)
  }, [contracts])

  // Selected contract
  const selectedContract = useMemo(() => {
    return activeContracts.find((c) => c.id === selectedContractId)
  }, [activeContracts, selectedContractId])

  // Fixed concepts from calculation (ALQUILER, PUNITORIOS, A_FAVOR)
  const fixedConcepts = useMemo(() => {
    if (!calcData?.concepts) return []
    return calcData.concepts
  }, [calcData])

  // Seed default concept types if none exist
  useEffect(() => {
    if (groupId && conceptTypes.length === 0) {
      seedDefaults()
    }
  }, [groupId, conceptTypes.length])

  // Group concept types by category
  const groupedConceptTypes = useMemo(() => {
    const groups = {}
    conceptTypes.forEach((ct) => {
      if (!groups[ct.category]) groups[ct.category] = []
      groups[ct.category].push(ct)
    })
    return groups
  }, [conceptTypes])

  // Add a concept row for a given type
  const addConcept = (conceptType) => {
    // Check if already added
    if (manualConcepts.some((c) => c.type === conceptType.name)) return
    setManualConcepts((prev) => [...prev, { type: conceptType.name, label: conceptType.label, amount: '' }])
  }

  const removeConcept = (type) => {
    setManualConcepts((prev) => prev.filter((c) => c.type !== type))
  }

  const updateConceptAmount = (type, amount) => {
    setManualConcepts((prev) =>
      prev.map((c) => (c.type === type ? { ...c, amount } : c))
    )
  }

  // Calculate total in real time
  const totalDue = useMemo(() => {
    let total = 0

    // Fixed concepts (alquiler, punitorios, a_favor)
    fixedConcepts.forEach((c) => {
      total += c.amount
    })

    // IVA manual
    const iva = parseFloat(ivaAmount) || 0
    total += iva

    // Manual concepts
    manualConcepts.forEach((c) => {
      total += parseFloat(c.amount) || 0
    })

    return total
  }, [fixedConcepts, ivaAmount, manualConcepts])

  const handleCreateConceptType = (data) => {
    createConceptType(data, {
      onSuccess: () => {
        setShowNewConceptForm(false)
      },
    })
  }

  const handleSubmit = (e) => {
    e.preventDefault()

    if (!selectedContractId) return

    // Build all concepts
    const concepts = []

    // Add fixed concepts (alquiler, punitorios, a_favor)
    fixedConcepts.forEach((c) => {
      concepts.push({
        type: c.type,
        amount: c.amount,
        description: c.description || null,
        isAutomatic: true,
      })
    })

    // Add IVA if entered
    const iva = parseFloat(ivaAmount) || 0
    if (iva > 0) {
      concepts.push({
        type: 'IVA',
        amount: iva,
        isAutomatic: false,
      })
    }

    // Add manual concepts
    manualConcepts.forEach((c) => {
      const val = parseFloat(c.amount) || 0
      if (val !== 0) {
        concepts.push({
          type: c.type,
          amount: val,
          isAutomatic: false,
        })
      }
    })

    const monthNumber = selectedContract
      ? selectedContract.currentMonth + 1
      : 1

    createPayment(
      {
        contractId: selectedContractId,
        monthNumber,
        periodMonth,
        periodYear,
        paymentDate: paymentDate || null,
        amountPaid: parseFloat(amountPaid) || 0,
        concepts,
        observations: observations || null,
      },
      {
        onSuccess: () => {
          navigate('/payment-history')
        },
      }
    )
  }

  // Year options
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear()
    return [current - 1, current, current + 1]
  }, [])

  if (isLoadingContracts) return <LoadingPage />

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
          <ArrowLeftIcon className="w-4 h-4" /> Volver
        </Button>
        <h1 className="text-3xl font-bold">Registrar Pago</h1>
        <p className="text-base-content/60 mt-1">{currentGroup?.name}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Contract + Period */}
        <Card title="Contrato y Período">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="form-control md:col-span-2">
              <label className="label">
                <span className="label-text font-medium">Contrato</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={selectedContractId}
                onChange={(e) => setSelectedContractId(e.target.value)}
                required
              >
                <option value="">Seleccionar contrato...</option>
                {activeContracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.tenant?.name} - {c.property?.address}
                    {c.property?.code ? ` (${c.property.code})` : ''} — Cuota{' '}
                    {c.currentMonth + 1}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Fecha de Pago</span>
              </label>
              <DateInput
                value={paymentDate}
                onChange={setPaymentDate}
              />
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Período de la cuota</span>
              </label>
              <div className="flex gap-2">
                <select
                  className="select select-bordered flex-1"
                  value={periodMonth}
                  onChange={(e) => setPeriodMonth(parseInt(e.target.value))}
                >
                  {MONTH_NAMES.map((name, i) => (
                    <option key={i} value={i + 1}>{name}</option>
                  ))}
                </select>
                <select
                  className="select select-bordered w-24"
                  value={periodYear}
                  onChange={(e) => setPeriodYear(parseInt(e.target.value))}
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </Card>

        {/* Show calculation only when contract selected */}
        {selectedContractId && (
          <>
            {/* Fixed Concepts (auto) */}
            <Card title="Conceptos Automáticos">
              {isCalculating ? (
                <div className="flex justify-center py-4">
                  <span className="loading loading-spinner loading-md"></span>
                </div>
              ) : (
                <div className="space-y-3">
                  {fixedConcepts.map((c) => (
                    <div
                      key={c.type}
                      className="flex justify-between items-center py-2 border-b border-base-200 last:border-0"
                    >
                      <div>
                        <span className="font-medium">{c.type}</span>
                        {c.description && (
                          <span className="text-sm text-base-content/60 ml-2">
                            ({c.description})
                          </span>
                        )}
                      </div>
                      <span
                        className={`font-bold ${c.amount < 0 ? 'text-success' : ''}`}
                      >
                        {c.amount < 0 ? '-' : ''}$
                        {Math.abs(c.amount).toLocaleString('es-AR')}
                      </span>
                    </div>
                  ))}

                  {fixedConcepts.length === 0 && (
                    <p className="text-base-content/60 text-center py-4">
                      Selecciona un contrato para ver los conceptos
                    </p>
                  )}
                </div>
              )}
            </Card>

            {/* IVA Manual */}
            <Card title="IVA">
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium">Monto IVA (ingreso manual)</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="bg-base-200 px-3 py-2 rounded text-sm font-medium">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input input-bordered w-full"
                    value={ivaAmount}
                    onChange={(e) => setIvaAmount(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <label className="label">
                  <span className="label-text-alt text-base-content/50">
                    Ingresá el IVA manualmente. Dejá en 0 si no corresponde.
                  </span>
                </label>
              </div>
            </Card>

            {/* Dynamic Concepts */}
            <Card
              title="Otros Conceptos"
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowNewConceptForm(!showNewConceptForm)}
                >
                  <PlusIcon className="w-4 h-4" />
                  Nuevo tipo
                </Button>
              }
            >
              {/* Form for creating new concept type */}
              {showNewConceptForm && (
                <div className="mb-4">
                  <NewConceptTypeForm
                    onSave={handleCreateConceptType}
                    onCancel={() => setShowNewConceptForm(false)}
                    categoryOptions={categoryOptions}
                  />
                </div>
              )}

              {/* Available concept types grouped by category */}
              <div className="space-y-3 mb-4">
                {Object.entries(groupedConceptTypes).map(([category, types]) => (
                  <div key={category}>
                    <span className="text-xs font-semibold text-base-content/50 uppercase">
                      {categoryLabelMap[category] || category}
                    </span>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {types.map((ct) => {
                        const isAdded = manualConcepts.some((c) => c.type === ct.name)
                        return (
                          <button
                            key={ct.id}
                            type="button"
                            className={`btn btn-xs ${isAdded ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => isAdded ? removeConcept(ct.name) : addConcept(ct)}
                          >
                            {isAdded ? '✓ ' : '+ '}{ct.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
                {conceptTypes.length === 0 && (
                  <p className="text-sm text-base-content/50">
                    No hay tipos de conceptos. Creá uno con el botón "Nuevo tipo".
                  </p>
                )}
              </div>

              {/* Editable rows for added concepts */}
              {manualConcepts.length > 0 && (
                <div className="space-y-2 border-t border-base-200 pt-3">
                  {manualConcepts.map((c) => (
                    <div key={c.type} className="flex items-center gap-2">
                      <span className="text-sm font-medium w-32 truncate">{c.label || c.type}</span>
                      <div className="flex items-center gap-1 flex-1">
                        <span className="bg-base-200 px-2 py-1 rounded text-sm">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="input input-bordered input-sm flex-1"
                          value={c.amount}
                          onChange={(e) => updateConceptAmount(c.type, e.target.value)}
                          placeholder="0"
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs text-error"
                        onClick={() => removeConcept(c.type)}
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Total + Amount Paid */}
            <Card>
              <div className="space-y-4">
                <div className="flex justify-between items-center py-3 border-b-2 border-primary">
                  <span className="text-xl font-bold">TOTAL A PAGAR</span>
                  <span className="text-2xl font-bold text-primary">
                    ${totalDue.toLocaleString('es-AR')}
                  </span>
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-medium text-lg">Monto Pagado</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="bg-base-200 px-3 py-2 rounded text-sm font-medium">$</span>
                    <input
                      type="number"
                      step="0.01"
                      className="input input-bordered input-lg w-full text-xl font-bold"
                      value={amountPaid}
                      onChange={(e) => setAmountPaid(e.target.value)}
                      placeholder={totalDue.toString()}
                      required
                    />
                  </div>
                  {parseFloat(amountPaid) > 0 &&
                    parseFloat(amountPaid) < totalDue && (
                      <label className="label">
                        <span className="label-text-alt text-warning">
                          Pago parcial - faltan $
                          {(totalDue - parseFloat(amountPaid)).toLocaleString('es-AR')}
                        </span>
                      </label>
                    )}
                  {parseFloat(amountPaid) > totalDue && (
                    <label className="label">
                      <span className="label-text-alt text-success">
                        A favor: $
                        {(parseFloat(amountPaid) - totalDue).toLocaleString('es-AR')}
                      </span>
                    </label>
                  )}
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Observaciones</span>
                  </label>
                  <textarea
                    className="textarea textarea-bordered"
                    rows={2}
                    value={observations}
                    onChange={(e) => setObservations(e.target.value)}
                    placeholder="Notas adicionales..."
                  />
                </div>
              </div>
            </Card>

            {/* Submit - REGISTRAR PAGO button */}
            <div className="flex justify-end gap-3">
              <Button
                variant="ghost"
                type="button"
                onClick={() => navigate(-1)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="success"
                loading={isCreating}
                disabled={!selectedContractId || totalDue <= 0}
                className="btn-lg"
              >
                <CheckCircleIcon className="w-6 h-6" />
                Registrar Pago
              </Button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}

export default PaymentForm
