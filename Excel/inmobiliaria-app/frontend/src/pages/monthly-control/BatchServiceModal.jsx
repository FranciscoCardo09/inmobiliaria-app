import { useState, useMemo, useCallback } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { usePropertyGroups } from '../../hooks/usePropertyGroups'
import {
  XMarkIcon,
  TrashIcon,
  FolderIcon,
  PlusIcon,
} from '@heroicons/react/24/outline'

const formatCurrency = (amount) => {
  if (amount === undefined || amount === null) return '$0'
  return `$${Math.round(amount).toLocaleString('es-AR')}`
}

export default function BatchServiceModal({ groupId, records, periodMonth, periodYear, onClose }) {
  const queryClient = useQueryClient()
  const { groups: savedGroups, createGroup, removeGroup, isLoading: groupsLoading } = usePropertyGroups(groupId)
  const [step, setStep] = useState(1)

  // Step 1 state
  const [selectedRecordIds, setSelectedRecordIds] = useState(new Set())

  // Step 2 state
  const [conceptTypeId, setConceptTypeId] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [description, setDescription] = useState('')
  const [distributions, setDistributions] = useState({})
  const [savingGroup, setSavingGroup] = useState(false)
  const [groupName, setGroupName] = useState('')

  // Fetch concept types
  const { data: conceptTypes = [] } = useQuery({
    queryKey: ['conceptTypes', groupId],
    queryFn: async () => {
      const res = await api.get(`/groups/${groupId}/payments/concept-types`)
      return res.data.data.filter((ct) => ct.isActive)
    },
    enabled: !!groupId,
  })

  const selectedRecords = useMemo(
    () => records.filter((r) => selectedRecordIds.has(r.id)),
    [records, selectedRecordIds]
  )

  const toggleRecord = (recordId) => {
    setSelectedRecordIds((prev) => {
      const next = new Set(prev)
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return next
    })
  }

  const loadGroup = (group) => {
    const newSelected = new Set()
    const newDist = {}
    for (const item of group.items) {
      const record = records.find((r) => r.contractId === item.contractId)
      if (record) {
        newSelected.add(record.id)
        newDist[record.id] = { percentage: item.percentage, locked: true }
      }
    }
    setSelectedRecordIds(newSelected)
    setDistributions(newDist)
    if (newSelected.size > 0) setStep(2)
  }

  const goToStep2 = () => {
    const count = selectedRecordIds.size
    if (count === 0) return
    const equalPct = Math.round((100 / count) * 100) / 100
    const newDist = {}
    let i = 0
    for (const id of selectedRecordIds) {
      if (distributions[id]) {
        newDist[id] = distributions[id]
      } else if (i === count - 1) {
        const usedPct = Object.values(newDist).reduce((s, d) => s + d.percentage, 0)
        newDist[id] = { percentage: Math.round((100 - usedPct) * 100) / 100, locked: false }
      } else {
        newDist[id] = { percentage: equalPct, locked: false }
      }
      i++
    }
    setDistributions(newDist)
    setStep(2)
  }

  const handlePercentageChange = useCallback((recordId, newPct) => {
    setDistributions((prev) => {
      const updated = { ...prev }
      newPct = Math.max(0, Math.min(100, newPct))
      updated[recordId] = { percentage: newPct, locked: true }

      const lockedSum = Object.entries(updated)
        .filter(([id, d]) => d.locked && id !== recordId)
        .reduce((s, [, d]) => s + d.percentage, 0) + newPct

      if (lockedSum > 100) return prev

      const remaining = 100 - lockedSum
      const unlockedIds = Object.keys(updated).filter((id) => !updated[id].locked)

      if (unlockedIds.length > 0) {
        const each = Math.round((remaining / unlockedIds.length) * 100) / 100
        unlockedIds.forEach((id, i) => {
          if (i === unlockedIds.length - 1) {
            const usedUnlocked = each * (unlockedIds.length - 1)
            updated[id] = { percentage: Math.round((remaining - usedUnlocked) * 100) / 100, locked: false }
          } else {
            updated[id] = { percentage: each, locked: false }
          }
        })
      }

      return updated
    })
  }, [])

  const unlockPercentage = (recordId) => {
    setDistributions((prev) => ({
      ...prev,
      [recordId]: { ...prev[recordId], locked: false },
    }))
  }

  const computedDistributions = useMemo(() => {
    const total = parseFloat(totalAmount) || 0
    return Object.entries(distributions).map(([recordId, { percentage, locked }]) => ({
      recordId,
      percentage,
      locked,
      amount: Math.round((total * percentage) / 100),
      record: records.find((r) => r.id === recordId),
    }))
  }, [distributions, totalAmount, records])

  const totalDistributed = computedDistributions.reduce((s, d) => s + d.amount, 0)

  const handleSaveGroup = async () => {
    if (!groupName.trim()) return
    const items = computedDistributions.map((d) => ({
      contractId: d.record.contractId,
      percentage: d.percentage,
    }))
    await createGroup({ name: groupName.trim(), items })
    setSavingGroup(false)
    setGroupName('')
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/groups/${groupId}/monthly-records/batch-services`, {
        conceptTypeId,
        totalAmount: parseFloat(totalAmount),
        description: description || undefined,
        distributions: computedDistributions.map((d) => ({
          recordId: d.recordId,
          percentage: d.percentage,
          amount: d.amount,
        })),
      })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monthlyServices'] })
      queryClient.invalidateQueries({ queryKey: ['monthlyRecords'] })
      toast.success('Servicios asignados correctamente')
      onClose()
    },
    onError: (e) => {
      toast.error(e.response?.data?.message || 'Error al asignar servicios')
    },
  })

  const selectedConceptType = conceptTypes.find((ct) => ct.id === conceptTypeId)
  const canSubmit = conceptTypeId && parseFloat(totalAmount) > 0 && computedDistributions.length > 0

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-w-3xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">Cargar Servicio Múltiple</h3>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose}>
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <ul className="steps steps-horizontal w-full mb-6">
          <li className={`step ${step >= 1 ? 'step-primary' : ''}`}>Selección</li>
          <li className={`step ${step >= 2 ? 'step-primary' : ''}`}>Distribución</li>
          <li className={`step ${step >= 3 ? 'step-primary' : ''}`}>Confirmación</li>
        </ul>

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

            <label className="label"><span className="label-text font-semibold">Seleccionar propiedades</span></label>
            <div className="max-h-64 overflow-y-auto border rounded-lg">
              {records.map((record) => (
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
                    <div className="font-medium text-sm">
                      {record.contract?.property?.address}
                      {record.contract?.property?.unit ? ` - ${record.contract.property.unit}` : ''}
                    </div>
                    <div className="text-xs text-base-content/60">
                      {record.contract?.tenant?.firstName} {record.contract?.tenant?.lastName}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="modal-action">
              <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              <button className="btn btn-primary" disabled={selectedRecordIds.size < 2} onClick={goToStep2}>
                Siguiente ({selectedRecordIds.size} seleccionadas)
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="label"><span className="label-text">Tipo de servicio</span></label>
                <select className="select select-bordered w-full select-sm" value={conceptTypeId} onChange={(e) => setConceptTypeId(e.target.value)}>
                  <option value="">Seleccionar...</option>
                  {conceptTypes.map((ct) => (
                    <option key={ct.id} value={ct.id}>{ct.label} ({ct.category})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label"><span className="label-text">Monto total</span></label>
                <input type="number" className="input input-bordered w-full input-sm" placeholder="100000" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} min="0" step="1" />
              </div>
            </div>
            <div className="mb-4">
              <label className="label"><span className="label-text">Descripción (opcional)</span></label>
              <input type="text" className="input input-bordered w-full input-sm" placeholder="Ej: Gas febrero" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <label className="label"><span className="label-text font-semibold">Distribución</span></label>
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Propiedad</th>
                    <th className="w-28">%</th>
                    <th className="w-32 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {computedDistributions.map((d) => (
                    <tr key={d.recordId}>
                      <td>
                        <div className="text-sm font-medium">
                          {d.record?.contract?.property?.address}
                          {d.record?.contract?.property?.unit ? ` - ${d.record.contract.property.unit}` : ''}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            className={`input input-bordered input-xs w-20 ${d.locked ? 'input-primary' : ''}`}
                            value={d.percentage}
                            onChange={(e) => handlePercentageChange(d.recordId, parseFloat(e.target.value) || 0)}
                            min="0" max="100" step="0.01"
                          />
                          {d.locked && (
                            <button className="btn btn-ghost btn-xs btn-circle" onClick={() => unlockPercentage(d.recordId)} title="Desbloquear para auto-ajuste">
                              🔓
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="text-right font-mono">{formatCurrency(d.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td>Total</td>
                    <td>{computedDistributions.reduce((s, d) => s + d.percentage, 0).toFixed(2)}%</td>
                    <td className="text-right font-mono">{formatCurrency(totalDistributed)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-3">
              {!savingGroup ? (
                <button className="btn btn-ghost btn-sm gap-1" onClick={() => setSavingGroup(true)}>
                  <PlusIcon className="w-4 h-4" /> Guardar como grupo
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <input type="text" className="input input-bordered input-sm flex-1" placeholder="Nombre del grupo..." value={groupName} onChange={(e) => setGroupName(e.target.value)} autoFocus />
                  <button className="btn btn-primary btn-sm" onClick={handleSaveGroup} disabled={!groupName.trim()}>Guardar</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSavingGroup(false)}>Cancelar</button>
                </div>
              )}
            </div>

            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setStep(1)}>Atrás</button>
              <button className="btn btn-primary" disabled={!canSubmit} onClick={() => setStep(3)}>Siguiente</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="alert mb-4">
              <div>
                <div className="font-bold">{selectedConceptType?.label}</div>
                <div className="text-sm">Total: {formatCurrency(parseFloat(totalAmount))}</div>
                {description && <div className="text-sm text-base-content/60">{description}</div>}
              </div>
            </div>

            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Propiedad</th>
                  <th className="text-right">%</th>
                  <th className="text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {computedDistributions.map((d) => (
                  <tr key={d.recordId}>
                    <td>
                      {d.record?.contract?.property?.address}
                      {d.record?.contract?.property?.unit ? ` - ${d.record.contract.property.unit}` : ''}
                    </td>
                    <td className="text-right">{d.percentage}%</td>
                    <td className="text-right font-mono">{formatCurrency(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td>Total</td>
                  <td></td>
                  <td className="text-right font-mono">{formatCurrency(totalDistributed)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setStep(2)}>Atrás</button>
              <button className="btn btn-primary" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
                {submitMutation.isPending ? <span className="loading loading-spinner loading-sm"></span> : 'Confirmar'}
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
