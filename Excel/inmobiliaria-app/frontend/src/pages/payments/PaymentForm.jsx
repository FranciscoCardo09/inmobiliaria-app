// PaymentForm - Phase 4 Intelligent Payment Form
import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeftIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { usePayments, usePaymentCalculation } from '../../hooks/usePayments'
import { useContracts } from '../../hooks/useContracts'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { LoadingPage } from '../../components/ui/Loading'

const EDITABLE_TYPES = [
  { type: 'EXPENSAS', label: 'Expensas' },
  { type: 'AGUA', label: 'Agua' },
  { type: 'SEGURO', label: 'Seguro' },
  { type: 'MUNICIPAL', label: 'Municipal' },
  { type: 'RENTAS', label: 'Rentas' },
  { type: 'DESCUENTO', label: 'Descuentos (se resta)' },
]

export const PaymentForm = () => {
  const navigate = useNavigate()
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const isEditing = !!id

  const { groups } = useAuthStore()
  const currentGroup = groups[0]
  const groupId = currentGroup?.id

  const { contracts, isLoading: isLoadingContracts } = useContracts(groupId)
  const { createPayment, isCreating } = usePayments(groupId)

  const [selectedContractId, setSelectedContractId] = useState(
    searchParams.get('contractId') || ''
  )
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split('T')[0]
  )
  const [editableConcepts, setEditableConcepts] = useState({
    EXPENSAS: 0,
    AGUA: 0,
    SEGURO: 0,
    MUNICIPAL: 0,
    RENTAS: 0,
    DESCUENTO: 0,
  })
  const [amountPaid, setAmountPaid] = useState('')
  const [observations, setObservations] = useState('')

  // Calculate payment preview when contract or date changes
  const { data: calcData, isLoading: isCalculating } = usePaymentCalculation(
    groupId,
    selectedContractId,
    paymentDate
  )

  // Pre-fill editable concepts from last payment
  useEffect(() => {
    if (calcData?.lastEditables) {
      setEditableConcepts((prev) => ({
        ...prev,
        ...Object.fromEntries(
          Object.entries(calcData.lastEditables).map(([k, v]) => [k, v || 0])
        ),
      }))
    }
  }, [calcData?.lastEditables])

  // Active contracts for dropdown
  const activeContracts = useMemo(() => {
    return (contracts || []).filter((c) => c.active)
  }, [contracts])

  // Selected contract details
  const selectedContract = useMemo(() => {
    return activeContracts.find((c) => c.id === selectedContractId)
  }, [activeContracts, selectedContractId])

  // Fixed concepts from calculation
  const fixedConcepts = useMemo(() => {
    if (!calcData?.concepts) return []
    return calcData.concepts
  }, [calcData])

  // Calculate total in real time
  const totalDue = useMemo(() => {
    let total = 0

    // Fixed concepts
    fixedConcepts.forEach((c) => {
      total += c.amount
    })

    // Editable concepts
    Object.entries(editableConcepts).forEach(([type, amount]) => {
      const val = parseFloat(amount) || 0
      if (type === 'DESCUENTO') {
        total -= Math.abs(val)
      } else {
        total += val
      }
    })

    return total
  }, [fixedConcepts, editableConcepts])

  // Update amountPaid to match totalDue when total changes
  useEffect(() => {
    if (amountPaid === '' || parseFloat(amountPaid) === 0) {
      setAmountPaid(totalDue > 0 ? totalDue.toString() : '')
    }
  }, [totalDue])

  const handleEditableChange = (type, value) => {
    setEditableConcepts((prev) => ({ ...prev, [type]: value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()

    if (!selectedContractId) return

    // Build all concepts
    const concepts = []

    // Add fixed concepts
    fixedConcepts.forEach((c) => {
      concepts.push({
        type: c.type,
        amount: c.amount,
        description: c.description || null,
        isAutomatic: true,
      })
    })

    // Add editable concepts (only non-zero)
    Object.entries(editableConcepts).forEach(([type, amount]) => {
      const val = parseFloat(amount) || 0
      if (val !== 0) {
        concepts.push({
          type,
          amount: type === 'DESCUENTO' ? -Math.abs(val) : val,
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
        paymentDate: paymentDate || null,
        amountPaid: parseFloat(amountPaid) || 0,
        concepts,
        observations: observations || null,
      },
      {
        onSuccess: () => {
          navigate('/dashboard')
        },
      }
    )
  }

  if (isLoadingContracts) return <LoadingPage />

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
          <ArrowLeftIcon className="w-4 h-4" /> Volver
        </Button>
        <h1 className="text-3xl font-bold">
          {isEditing ? 'Editar Pago' : 'Nuevo Pago'}
        </h1>
        <p className="text-base-content/60 mt-1">
          {currentGroup?.name}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Contract selector */}
        <Card title="Contrato">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="form-control">
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
                    {c.property?.code ? ` (${c.property.code})` : ''} — Mes{' '}
                    {c.currentMonth + 1}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Fecha de Pago</span>
              </label>
              <input
                type="date"
                className="input input-bordered w-full"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
          </div>
        </Card>

        {/* Show calculation only when contract selected */}
        {selectedContractId && (
          <>
            {/* Fixed Concepts */}
            <Card title="Conceptos Fijos (auto-calculados)">
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

            {/* Editable Concepts */}
            <Card title="Conceptos Editables">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {EDITABLE_TYPES.map(({ type, label }) => (
                  <div key={type} className="form-control">
                    <label className="label">
                      <span className="label-text">{label}</span>
                    </label>
                    <div className="input-group">
                      <span className="bg-base-200 px-3 flex items-center text-sm">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input input-bordered w-full"
                        value={editableConcepts[type] || ''}
                        onChange={(e) =>
                          handleEditableChange(type, e.target.value)
                        }
                        placeholder="0"
                      />
                    </div>
                  </div>
                ))}
              </div>
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
                    <span className="label-text font-medium text-lg">
                      Monto Pagado
                    </span>
                  </label>
                  <div className="input-group">
                    <span className="bg-base-200 px-3 flex items-center text-sm">$</span>
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
                          {(totalDue - parseFloat(amountPaid)).toLocaleString(
                            'es-AR'
                          )}
                        </span>
                      </label>
                    )}
                  {parseFloat(amountPaid) > totalDue && (
                    <label className="label">
                      <span className="label-text-alt text-success">
                        A favor: $
                        {(parseFloat(amountPaid) - totalDue).toLocaleString(
                          'es-AR'
                        )}
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

            {/* Submit */}
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
              >
                <CheckCircleIcon className="w-5 h-5" />
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
