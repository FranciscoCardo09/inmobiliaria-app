import { useState, useMemo } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { usePropertyGroups } from '../../hooks/usePropertyGroups'
import {
  XMarkIcon,
  TrashIcon,
  FolderIcon,
  MagnifyingGlassIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline'

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const formatCurrency = (amount) => {
  if (amount === undefined || amount === null) return '$0'
  return `$${Math.round(amount).toLocaleString('es-AR')}`
}

export default function BulkLoadServiceModal({ groupId, records, periodMonth, periodYear, onClose }) {
  const queryClient = useQueryClient()
  const { groups: savedGroups, removeGroup } = usePropertyGroups(groupId)
  const [step, setStep] = useState(1)

  // Step 1 state
  const [selectedRecordIds, setSelectedRecordIds] = useState(new Set())
  const [searchTerm, setSearchTerm] = useState('')

  // Step 2 state - months
  const [selectedYear, setSelectedYear] = useState(periodYear)
  const [selectedMonths, setSelectedMonths] = useState([{ month: periodMonth, year: periodYear }])

  // Step 2 state - service & amount
  const [conceptTypeId, setConceptTypeId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')

  // Fetch concept types
  const { data: conceptTypes = [] } = useQuery({
    queryKey: ['conceptTypes', groupId],
    queryFn: async () => {
      const res = await api.get(`/groups/${groupId}/payments/concept-types`)
      return res.data.data.filter((ct) => ct.isActive)
    },
    enabled: !!groupId,
  })

  const getRecordLabel = (record) => {
    const address = record?.property?.address || ''
    const unit = record?.property?.unit ? ` - ${record.property.unit}` : ''
    return `${address}${unit}`
  }
  const getRecordTenant = (record) => {
    if (record?.tenants?.length > 0) return record.tenants.map((t) => t.name).join(' / ')
    return record?.tenant?.name || ''
  }

  const filteredRecords = useMemo(() => {
    if (!searchTerm.trim()) return records
    const term = searchTerm.toLowerCase().trim()
    return records.filter((r) => {
      const address = (r.property?.address || '').toLowerCase()
      const unit = (r.property?.unit || '').toLowerCase()
      const tenant = getRecordTenant(r).toLowerCase()
      const owner = (r.owner?.name || '').toLowerCase()
      return address.includes(term) || unit.includes(term) || tenant.includes(term) || owner.includes(term)
    })
  }, [records, searchTerm])

  const toggleRecord = (recordId) => {
    setSelectedRecordIds((prev) => {
      const next = new Set(prev)
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return next
    })
  }

  const selectAll = () => setSelectedRecordIds(new Set(filteredRecords.map((r) => r.id)))
  const deselectAll = () => setSelectedRecordIds(new Set())

  const loadGroup = (group) => {
    const newSelected = new Set()
    for (const item of group.items) {
      const record = records.find((r) => r.contractId === item.contractId)
      if (record) newSelected.add(record.id)
    }
    setSelectedRecordIds(newSelected)
  }

  // Month selection helpers
  const isMonthSelected = (month, year) =>
    selectedMonths.some((m) => m.month === month && m.year === year)

  const toggleMonth = (month, year) => {
    setSelectedMonths((prev) => {
      const exists = prev.some((m) => m.month === month && m.year === year)
      if (exists) return prev.filter((m) => !(m.month === month && m.year === year))
      return [...prev, { month, year }]
    })
  }

  const sortedSelectedMonths = useMemo(
    () => [...selectedMonths].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month),
    [selectedMonths]
  )

  const selectedConceptType = conceptTypes.find((ct) => ct.id === conceptTypeId)
  const amountNum = parseFloat(amount) || 0
  const selectedRecordsArray = records.filter((r) => selectedRecordIds.has(r.id))
  const totalCombinations = selectedRecordsArray.length * selectedMonths.length
  const grandTotal = amountNum * totalCombinations

  const canGoStep2 = selectedRecordIds.size >= 1
  const canGoStep3 = conceptTypeId && amountNum > 0 && selectedMonths.length >= 1

  const submitMutation = useMutation({
    mutationFn: async () => {
      const contractIds = selectedRecordsArray.map((r) => r.contractId)
      const res = await api.post(`/groups/${groupId}/monthly-records/bulk-load-services`, {
        contractIds,
        conceptTypeId,
        amount: amountNum,
        months: selectedMonths,
        description: description || undefined,
      })
      return res.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['monthlyRecords', groupId] })
      queryClient.invalidateQueries({ queryKey: ['monthlyServices'] })
      const assigned = data?.data?.totalAssigned ?? totalCombinations
      toast.success(`Se cargaron ${assigned} servicios correctamente`)
      onClose()
    },
    onError: (e) => {
      toast.error(e.response?.data?.message || 'Error al cargar servicios')
    },
  })

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-w-3xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CalendarDaysIcon className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-lg">Carga Masiva de Servicios</h3>
          </div>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose}>
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <ul className="steps steps-horizontal w-full mb-6">
          <li className={`step ${step >= 1 ? 'step-primary' : ''}`}>Propiedades</li>
          <li className={`step ${step >= 2 ? 'step-primary' : ''}`}>Meses y Servicio</li>
          <li className={`step ${step >= 3 ? 'step-primary' : ''}`}>Confirmación</li>
        </ul>

        {/* ─── STEP 1: Properties ─── */}
        {step === 1 && (
          <div>
            {savedGroups.length > 0 && (
              <div className="mb-4">
                <label className="label"><span className="label-text font-semibold">Grupos guardados</span></label>
                <div className="flex flex-wrap gap-2">
                  {savedGroups.map((g) => (
                    <div key={g.id} className="flex items-center gap-1">
                      <button className="btn btn-sm btn-outline gap-1" onClick={() => loadGroup(g)}>
                        <FolderIcon className="w-4 h-4" />
                        {g.name} ({g.items.length})
                      </button>
                      <button className="btn btn-ghost btn-xs btn-circle" onClick={() => removeGroup(g.id)} title="Eliminar grupo">
                        <TrashIcon className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-1">
              <label className="label py-0"><span className="label-text font-semibold">Seleccionar propiedades</span></label>
              <div className="flex gap-2">
                <button className="btn btn-xs btn-ghost" onClick={selectAll}>Todas</button>
                <button className="btn btn-xs btn-ghost" onClick={deselectAll}>Ninguna</button>
              </div>
            </div>

            <div className="relative mb-2">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40" />
              <input
                type="text"
                className="input input-bordered input-sm w-full pl-9"
                placeholder="Buscar por propiedad, inquilino, dueño..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="max-h-64 overflow-y-auto border rounded-lg">
              {filteredRecords.map((record) => (
                <label
                  key={record.id}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-base-200 border-b last:border-b-0 ${
                    selectedRecordIds.has(record.id) ? 'bg-primary/10' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm checkbox-primary"
                    checked={selectedRecordIds.has(record.id)}
                    onChange={() => toggleRecord(record.id)}
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{getRecordLabel(record)}</div>
                    <div className="text-xs text-base-content/60">{getRecordTenant(record)}</div>
                  </div>
                </label>
              ))}
            </div>

            <div className="modal-action">
              <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              <button className="btn btn-primary" disabled={!canGoStep2} onClick={() => setStep(2)}>
                Siguiente ({selectedRecordIds.size} seleccionadas)
              </button>
            </div>
          </div>
        )}

        {/* ─── STEP 2: Months + Service + Amount ─── */}
        {step === 2 && (
          <div>
            {/* Month picker */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="label-text font-semibold">Seleccionar meses</label>
                <div className="flex items-center gap-2">
                  <button className="btn btn-ghost btn-xs" onClick={() => setSelectedYear((y) => y - 1)}>◀</button>
                  <span className="font-bold w-12 text-center">{selectedYear}</span>
                  <button className="btn btn-ghost btn-xs" onClick={() => setSelectedYear((y) => y + 1)}>▶</button>
                </div>
              </div>
              <div className="grid grid-cols-6 gap-1">
                {MONTH_NAMES.map((name, i) => {
                  const m = i + 1
                  const selected = isMonthSelected(m, selectedYear)
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => toggleMonth(m, selectedYear)}
                      className={`btn btn-sm ${selected ? 'btn-primary' : 'btn-outline'}`}
                    >
                      {name}
                    </button>
                  )
                })}
              </div>
              {selectedMonths.length > 0 && (
                <div className="mt-2 text-sm text-base-content/70">
                  <span className="font-medium">{selectedMonths.length} {selectedMonths.length === 1 ? 'mes' : 'meses'}:</span>{' '}
                  {sortedSelectedMonths.map((m) => `${MONTH_NAMES[m.month - 1]} ${m.year}`).join(', ')}
                </div>
              )}
            </div>

            {/* Service & amount */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="label"><span className="label-text">Tipo de servicio</span></label>
                <select
                  className="select select-bordered w-full select-sm"
                  value={conceptTypeId}
                  onChange={(e) => setConceptTypeId(e.target.value)}
                >
                  <option value="">Seleccionar...</option>
                  {conceptTypes.map((ct) => (
                    <option key={ct.id} value={ct.id}>{ct.label} ({ct.category})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label"><span className="label-text">Monto por propiedad por mes</span></label>
                <input
                  type="number"
                  className="input input-bordered w-full input-sm"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  min="0"
                  step="1"
                />
              </div>
            </div>
            <div className="mb-4">
              <label className="label"><span className="label-text">Descripción (opcional)</span></label>
              <input
                type="text"
                className="input input-bordered w-full input-sm"
                placeholder="Ej: Gas enero-marzo"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Summary */}
            {amountNum > 0 && selectedRecordIds.size > 0 && selectedMonths.length > 0 && (
              <div className="alert alert-info text-sm">
                Se aplicará <strong>{selectedConceptType?.label || '—'}</strong> por{' '}
                <strong>{formatCurrency(amountNum)}</strong> a{' '}
                <strong>{selectedRecordIds.size}</strong> propiedad{selectedRecordIds.size !== 1 ? 'es' : ''} ×{' '}
                <strong>{selectedMonths.length}</strong> {selectedMonths.length === 1 ? 'mes' : 'meses'} ={' '}
                <strong>{totalCombinations}</strong> registros.{' '}
                Total: <strong>{formatCurrency(grandTotal)}</strong>
              </div>
            )}

            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setStep(1)}>Atrás</button>
              <button className="btn btn-primary" disabled={!canGoStep3} onClick={() => setStep(3)}>
                Siguiente
              </button>
            </div>
          </div>
        )}

        {/* ─── STEP 3: Confirmation ─── */}
        {step === 3 && (
          <div>
            <div className="alert mb-4">
              <div>
                <div className="font-bold">{selectedConceptType?.label}</div>
                <div className="text-sm">
                  {formatCurrency(amountNum)} × {selectedRecordsArray.length} propiedad{selectedRecordsArray.length !== 1 ? 'es' : ''} × {selectedMonths.length} {selectedMonths.length === 1 ? 'mes' : 'meses'} = <strong>{formatCurrency(grandTotal)}</strong> total
                </div>
                {description && <div className="text-sm text-base-content/60">{description}</div>}
              </div>
            </div>

            <div className="alert alert-warning text-sm mb-4">
              Si alguna propiedad ya tiene este servicio en el período seleccionado, el monto será actualizado.
            </div>

            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="table table-xs">
                <thead className="sticky top-0 bg-base-200">
                  <tr>
                    <th>Propiedad</th>
                    <th>Meses</th>
                    <th className="text-right">Por registro</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRecordsArray.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="font-medium">{getRecordLabel(r)}</div>
                        <div className="text-xs text-base-content/60">{getRecordTenant(r)}</div>
                      </td>
                      <td className="text-xs text-base-content/70">
                        {sortedSelectedMonths.map((m) => `${MONTH_NAMES[m.month - 1]} ${m.year}`).join(', ')}
                      </td>
                      <td className="text-right font-mono">{formatCurrency(amountNum)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td colSpan={2}>Total ({totalCombinations} registros)</td>
                    <td className="text-right font-mono">{formatCurrency(grandTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setStep(2)}>Atrás</button>
              <button
                className="btn btn-primary"
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending ? (
                  <span className="loading loading-spinner loading-sm"></span>
                ) : (
                  `Confirmar (${totalCombinations} registros)`
                )}
              </button>
            </div>
          </div>
        )}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  )
}
