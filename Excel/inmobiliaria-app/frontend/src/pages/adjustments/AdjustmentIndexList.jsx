// Adjustment Index List - Selector mes/año
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  PlusIcon, 
  PencilIcon, 
  TrashIcon, 
  ChevronLeftIcon, 
  ChevronRightIcon,
  CheckCircleIcon,
  ArrowUturnLeftIcon,
  CalendarIcon
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useAdjustmentIndices } from '../../hooks/useAdjustmentIndices'
import api from '../../services/api'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import { LoadingPage } from '../../components/ui/Loading'
import toast from 'react-hot-toast'

const monthNames = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export const AdjustmentIndexList = () => {
  const navigate = useNavigate()
  const { groups, currentGroupId } = useAuthStore()
  const currentGroup = groups.find(g => g.id === currentGroupId) || groups[0]

  const {
    indices,
    isLoading,
    deleteIndex,
    isDeleting,
    getContractsForMonth,
    applyToMonth,
    isApplyingToMonth,
    undoMonth,
    isUndoingMonth,
  } = useAdjustmentIndices(currentGroup?.id)

  // Estado para selector de mes/año
  const now = new Date()
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1)
  const [periodYear, setPeriodYear] = useState(now.getFullYear())
  
  const [contractsForMonth, setContractsForMonth] = useState([])
  const [loadingContracts, setLoadingContracts] = useState(false)
  
  // Estado para valores de porcentaje por índice
  const [indexValues, setIndexValues] = useState({})
  
  // Modal de confirmación
  const [showModal, setShowModal] = useState(false)
  const [confirmData, setConfirmData] = useState(null)
  
  // Modal de deshacer
  const [showUndoModal, setShowUndoModal] = useState(false)
  const [undoData, setUndoData] = useState(null)

  // Inicializar valores cuando se cargan los índices
  useEffect(() => {
    if (indices.length > 0) {
      const values = {}
      indices.forEach((idx) => {
        values[idx.id] = idx.currentValue || 0
      })
      setIndexValues(values)
    }
  }, [indices])

  // Cargar contratos para el mes seleccionado
  useEffect(() => {
    const loadContracts = async () => {
      if (!currentGroup?.id) return
      
      setLoadingContracts(true)
      try {
        const response = await api.get(
          `/groups/${currentGroup.id}/adjustments/contracts-by-calendar`,
          { params: { month: periodMonth, year: periodYear } }
        )
        setContractsForMonth(response.data.data || [])
      } catch (error) {
        console.error('Error al cargar contratos:', error)
        setContractsForMonth([])
      } finally {
        setLoadingContracts(false)
      }
    }

    loadContracts()
  }, [periodMonth, periodYear, currentGroup?.id])

  const handleValueChange = (indexId, value) => {
    setIndexValues({ ...indexValues, [indexId]: value })
  }

  const handleDelete = async (index) => {
    const contractCount = index._count?.contracts || 0

    if (contractCount > 0) {
      toast.error(
        `No se puede eliminar "${index.name}" porque tiene ${contractCount} contrato(s) asignado(s)`,
        { duration: 4000 }
      )
      return
    }

    const confirmResult = window.confirm(
      `¿Eliminar el índice "${index.name}"?\n\nEsta acción no se puede deshacer.`
    )

    if (!confirmResult) return

    deleteIndex(index.id, {
      onSuccess: () => {
        toast.success(`Índice "${index.name}" eliminado`)
      },
    })
  }

  const handleApplyAdjustment = async (index) => {
    const value = parseFloat(indexValues[index.id])

    if (isNaN(value) || value <= 0) {
      toast.error('Ingrese un porcentaje válido mayor a 0')
      return
    }

    // Filtrar contratos para este índice
    const affectedContracts = contractsForMonth.filter(
      (c) => c.adjustmentIndex?.id === index.id
    )
    const count = affectedContracts.length

    if (count === 0) {
      toast.error(`No hay contratos con "${index.name}" que ajusten en ${monthNames[periodMonth]} ${periodYear}`)
      return
    }

    // Preparar datos para el modal
    const contractsWithCalculations = affectedContracts.map((contract) => {
      const currentRent = contract.baseRent
      const newRent = Math.round(currentRent * (1 + value / 100))
      const increase = newRent - currentRent

      return {
        ...contract,
        currentRent,
        newRent,
        increase,
      }
    })

    const totalIncrease = contractsWithCalculations.reduce(
      (sum, c) => sum + c.increase,
      0
    )

    setConfirmData({
      index,
      percentage: value,
      contracts: contractsWithCalculations,
      totalIncrease,
      count,
      calendarMonth: periodMonth,
      calendarYear: periodYear,
      monthName: `${monthNames[periodMonth]} ${periodYear}`,
    })
    setShowModal(true)
  }

  const confirmApply = async () => {
    if (!confirmData) return

    try {
      const response = await api.post(
        `/groups/${currentGroup.id}/adjustment-indices/${confirmData.index.id}/apply-to-calendar`,
        { 
          percentageIncrease: confirmData.percentage,
          calendarMonth: confirmData.calendarMonth,
          calendarYear: confirmData.calendarYear
        }
      )
      
      toast.success(
        `Ajuste del ${confirmData.percentage}% aplicado a ${confirmData.count} contrato(s) para ${confirmData.monthName}`,
        { duration: 4000 }
      )
      setShowModal(false)
      setConfirmData(null)
      // Recargar contratos
      loadContractsForMonth()
    } catch (error) {
      console.error('Error al aplicar ajuste:', error)
      toast.error(error.response?.data?.message || 'Error al aplicar ajuste')
    }
  }

  const cancelApply = () => {
    setShowModal(false)
    setConfirmData(null)
  }

  const handleUndoAdjustment = (index) => {
    // Verificar si hay contratos con historial para este mes
    const affectedContracts = contractsForMonth.filter(
      (c) => c.adjustmentIndex?.id === index.id && c.rentHistory?.length > 0
    )

    if (affectedContracts.length === 0) {
      toast.error(`No hay ajustes aplicados para "${index.name}" en ${monthNames[periodMonth]} ${periodYear}`)
      return
    }

    setUndoData({
      index,
      calendarMonth: periodMonth,
      calendarYear: periodYear,
      monthName: `${monthNames[periodMonth]} ${periodYear}`,
      count: affectedContracts.length,
      contracts: affectedContracts,
    })
    setShowUndoModal(true)
  }

  const confirmUndo = async () => {
    if (!undoData) return

    try {
      await api.post(
        `/groups/${currentGroup.id}/adjustment-indices/${undoData.index.id}/undo-calendar`,
        { 
          calendarMonth: undoData.calendarMonth,
          calendarYear: undoData.calendarYear
        }
      )
      
      toast.success('Ajuste revertido correctamente')
      setShowUndoModal(false)
      setUndoData(null)
      // Recargar contratos
      loadContractsForMonth()
    } catch (error) {
      console.error('Error al deshacer ajuste:', error)
      toast.error(error.response?.data?.message || 'Error al deshacer ajuste')
    }
  }

  const cancelUndo = () => {
    setShowUndoModal(false)
    setUndoData(null)
  }

  const loadContractsForMonth = async () => {
    if (!currentGroup?.id) return
    
    setLoadingContracts(true)
    try {
      const response = await api.get(
        `/groups/${currentGroup.id}/adjustments/contracts-by-calendar`,
        { params: { month: periodMonth, year: periodYear } }
      )
      setContractsForMonth(response.data.data || [])
    } catch (error) {
      console.error('Error al cargar contratos:', error)
      setContractsForMonth([])
    } finally {
      setLoadingContracts(false)
    }
  }

  if (isLoading) return <LoadingPage />

  // Agrupar contratos por índice
  const contractsByIndex = {}
  contractsForMonth.forEach((contract) => {
    const indexId = contract.adjustmentIndex?.id
    if (indexId) {
      if (!contractsByIndex[indexId]) {
        contractsByIndex[indexId] = []
      }
      contractsByIndex[indexId].push(contract)
    }
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Índices de Ajuste</h1>
          <p className="text-gray-600 mt-1">
            Gestione índices y aplique ajustes por mes
          </p>
        </div>
        <Button
          variant="primary"
          icon={PlusIcon}
          onClick={() => navigate('/adjustments/new')}
        >
          Nuevo Índice
        </Button>
      </div>

      {/* Selector de Mes/Año */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-5 h-5 text-gray-500" />
          <select 
            className="select select-bordered select-sm w-32" 
            value={periodMonth} 
            onChange={(e) => setPeriodMonth(parseInt(e.target.value))}
          >
            {monthNames.slice(1).map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
          <select 
            className="select select-bordered select-sm w-24" 
            value={periodYear} 
            onChange={(e) => setPeriodYear(parseInt(e.target.value))}
          >
            {[2024, 2025, 2026, 2027, 2028].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="text-sm text-gray-500">
          {contractsForMonth.length} contrato(s) con ajuste programado
        </div>
      </div>

      {/* Índices Registrados con Inputs */}
      <Card>
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-4">Índices Registrados</h2>

          {indices.length === 0 ? (
            <EmptyState
              title="No hay índices de ajuste"
              description="Cree un índice para comenzar"
              icon={PlusIcon}
              action={{
                label: 'Crear Índice',
                onClick: () => navigate('/adjustments/new'),
              }}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {indices.map((index) => {
                const indexContracts = contractsByIndex[index.id] || []
                const hasAppliedAdjustments = indexContracts.some(
                  (c) => c.rentHistory?.length > 0
                )

                return (
                  <div
                    key={index.id}
                    className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          {index.name}
                        </h3>
                        <p className="text-sm text-gray-500">
                          Frecuencia: {index.frequencyMonths} mes(es)
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          className="btn btn-ghost btn-sm btn-square"
                          onClick={() =>
                            navigate(`/adjustments/${index.id}/edit`)
                          }
                        >
                          <PencilIcon className="w-4 h-4" />
                        </button>
                        <button
                          className="btn btn-ghost btn-sm btn-square text-error"
                          onClick={() => handleDelete(index)}
                          disabled={isDeleting}
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {/* Porcentaje para este mes */}
                      <div>
                        <label className="label label-text text-xs">
                          Porcentaje {monthNames[periodMonth]}:
                        </label>
                        <div className="flex items-center gap-2">
                          <div className="input-group input-group-sm flex-1">
                            <input
                              type="number"
                              step="0.1"
                              className="input input-bordered input-sm w-full"
                              value={indexValues[index.id] || ''}
                              onChange={(e) =>
                                handleValueChange(index.id, e.target.value)
                              }
                              placeholder="0"
                              disabled={indexContracts.length === 0}
                            />
                            <span className="bg-gray-200">%</span>
                          </div>
                        </div>
                      </div>

                      {/* Botones de acción */}
                      {indexContracts.length > 0 && (
                        <div className="flex gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            icon={CheckCircleIcon}
                            onClick={() => handleApplyAdjustment(index)}
                            disabled={isApplyingToMonth}
                            loading={isApplyingToMonth}
                            className="flex-1"
                          >
                            Aplicar
                          </Button>

                          {hasAppliedAdjustments && (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={ArrowUturnLeftIcon}
                              onClick={() => handleUndoAdjustment(index)}
                              disabled={isUndoingMonth}
                              loading={isUndoingMonth}
                            >
                              Deshacer
                            </Button>
                          )}
                        </div>
                      )}

                      {/* Info adicional */}
                      <div className="pt-2 border-t text-sm space-y-1">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Contratos totales:</span>
                          <span className="font-medium">
                            {index._count?.contracts || 0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Este mes:</span>
                          <span className="font-medium text-primary-600">
                            {indexContracts.length}
                          </span>
                        </div>
                        {hasAppliedAdjustments && (
                          <div className="badge badge-sm badge-success w-full">
                            Ajuste Aplicado
                          </div>
                        )}
                        {index.lastUpdated && (
                          <div className="text-xs text-gray-400">
                            Actualizado:{' '}
                            {new Date(index.lastUpdated).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Contratos que se Actualizan */}
      <Card>
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-4">
            Propiedades que se Actualizan - {monthNames[periodMonth]} {periodYear}
          </h2>

          {loadingContracts ? (
            <div className="text-center py-8">
              <div className="loading loading-spinner loading-lg"></div>
              <p className="text-gray-500 mt-2">Cargando contratos...</p>
            </div>
          ) : contractsForMonth.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">
                No hay contratos con ajuste programado para {monthNames[periodMonth]} {periodYear}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Índice</th>
                    <th>Inquilino</th>
                    <th>Propiedad</th>
                    <th className="text-right">Alquiler Actual</th>
                    <th className="text-right">Ajuste Aplicado</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {contractsForMonth.map((contract) => {
                    const hasHistory = contract.rentHistory?.length > 0
                    const adjustedRent = hasHistory ? contract.rentHistory[0]?.rentAmount : null
                    
                    return (
                      <tr key={contract.id}>
                        <td>
                          <span className="badge badge-sm badge-primary">
                            {contract.adjustmentIndex?.name}
                          </span>
                        </td>
                        <td>{contract.tenant?.name}</td>
                        <td>{contract.property?.address}</td>
                        <td className="text-right font-mono">
                          ${contract.baseRent?.toLocaleString()}
                        </td>
                        <td className="text-right font-mono">
                          {adjustedRent ? (
                            <span className="text-green-600 font-semibold">
                              ${adjustedRent.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td>
                          {hasHistory ? (
                            <span className="badge badge-sm badge-success">
                              Aplicado
                            </span>
                          ) : (
                            <span className="badge badge-sm badge-warning">
                              Pendiente
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* Modal de Confirmación - Aplicar */}
      {showModal && confirmData && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <h3 className="font-bold text-lg mb-4">Confirmar Ajuste</h3>

            <div className="mb-4">
              <p className="text-gray-700">
                Aplicar ajuste del{' '}
                <span className="font-bold text-primary-600">
                  {confirmData.percentage}%
                </span>{' '}
                al índice{' '}
                <span className="font-semibold">{confirmData.index.name}</span>
              </p>
              <p className="text-sm text-gray-500 mt-1">
                Mes objetivo: <span className="font-semibold">{confirmData.monthName}</span>
              </p>
              <p className="text-sm text-gray-500">
                Contratos afectados: {confirmData.count}
              </p>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-yellow-800 font-medium">
                ⚠️ Esta acción modificará los alquileres de forma permanente.
                Use "Deshacer" si necesita revertir los cambios.
              </p>
            </div>

            {/* Detalles de contratos */}
            <div className="mb-4 max-h-64 overflow-y-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Inquilino</th>
                    <th>Propiedad</th>
                    <th className="text-right">Actual</th>
                    <th className="text-right">Nuevo</th>
                    <th className="text-right">Aumento</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmData.contracts.map((c) => (
                    <tr key={c.id}>
                      <td className="text-sm">{c.tenant?.name}</td>
                      <td className="text-sm">{c.property?.address}</td>
                      <td className="text-right font-mono text-sm">
                        ${c.currentRent.toLocaleString()}
                      </td>
                      <td className="text-right font-mono text-sm font-semibold text-green-600">
                        ${c.newRent.toLocaleString()}
                      </td>
                      <td className="text-right font-mono text-sm text-green-600">
                        +${c.increase.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td colSpan="4" className="text-right">
                      Aumento Total:
                    </td>
                    <td className="text-right text-green-600">
                      +${confirmData.totalIncrease.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="modal-action">
              <button className="btn btn-ghost" onClick={cancelApply}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={confirmApply}
                disabled={isApplyingToMonth}
              >
                {isApplyingToMonth ? (
                  <span className="loading loading-spinner"></span>
                ) : null}
                Confirmar Ajuste
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={cancelApply}>close</button>
          </form>
        </dialog>
      )}

      {/* Modal de Confirmación - Deshacer */}
      {showUndoModal && undoData && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg mb-4">Confirmar Deshacer</h3>

            <div className="mb-4">
              <p className="text-gray-700">
                ¿Deshacer ajuste del índice{' '}
                <span className="font-semibold">{undoData.index.name}</span>
                {' '}para {undoData.monthName}?
              </p>
              <p className="text-sm text-gray-500 mt-2">
                Se revertirán {undoData.count} contrato(s) al valor anterior.
              </p>
            </div>

            <div className="bg-warning/10 border border-warning rounded-lg p-4 mb-4">
              <p className="text-sm text-warning-content">
                ⚠️ Esta acción eliminará el registro del ajuste del historial.
              </p>
            </div>

            <div className="modal-action">
              <button className="btn btn-ghost" onClick={cancelUndo}>
                Cancelar
              </button>
              <button
                className="btn btn-warning"
                onClick={confirmUndo}
                disabled={isUndoingMonth}
              >
                {isUndoingMonth ? (
                  <span className="loading loading-spinner"></span>
                ) : null}
                Deshacer
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={cancelUndo}>close</button>
          </form>
        </dialog>
      )}
    </div>
  )
}
