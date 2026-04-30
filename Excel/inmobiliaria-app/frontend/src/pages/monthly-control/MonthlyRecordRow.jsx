import { useState, useEffect, memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMonthlyServices } from '../../hooks/useMonthlyServices'
import api from '../../services/api'
import {
  ChevronUpIcon,
  ChevronDownIcon,
  CheckCircleIcon,
  CurrencyDollarIcon,
  EyeIcon,
  BanknotesIcon,
  NoSymbolIcon,
  BellIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline'

const formatCurrency = (amount) => {
  if (amount === undefined || amount === null) return '$0'
  return `$${Math.round(amount).toLocaleString('es-AR')}`
}

const formatDateShort = (dateStr) => {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const year = d.getUTCFullYear()
  return `${day}/${month}/${year}`
}

const BoolBadge = ({ value, yesText = 'SI', noText = 'NO' }) => (
  <span className={`badge badge-sm ${value ? 'badge-success' : 'badge-ghost'}`}>
    {value ? yesText : noText}
  </span>
)

// Memoized table row to prevent re-renders when unrelated state changes
export const MonthlyRecordRow = memo(function MonthlyRecordRow({
  record, idx, isExpanded, showIvaColumn, groupId,
  onToggleRow, onToggleIva, onPayment, onDebtPayment, onTxHistory, onForgiveBalance, onForgiveDebt, onToggleComprobante, onNotify,
}) {
  const isPropietario = (record.contractType || 'INQUILINO') === 'PROPIETARIO'
  const isPenalty = !!record.isPenaltyRecord

  const rowClass = isPenalty
    ? 'bg-warning/15 border-l-4 border-warning'
    : record.status === 'COMPLETE'
    ? 'bg-success/25'
    : record.contractHasOpenDebt
    ? 'bg-error/10'
    : record.status === 'PARTIAL'
    ? 'bg-warning/10'
    : isPropietario
    ? 'bg-secondary/5'
    : idx % 2 === 1
    ? 'bg-base-200/50'
    : ''

  const servicesTooltip = !record.services || record.services.length === 0
    ? 'Sin servicios'
    : record.services
        .map((s) => `${s.conceptType?.label || s.conceptType?.name}: ${formatCurrency(s.amount)}`)
        .join('\n')

  return (
    <>
      <tr className={rowClass}>
        <td className="text-center">
          <button
            className="btn btn-xs btn-ghost"
            onClick={() => onToggleRow(record.id)}
            title={isExpanded ? 'Colapsar' : 'Expandir para gestionar servicios'}
          >
            {isExpanded ? (
              <ChevronUpIcon className="w-3 h-3" />
            ) : (
              <ChevronDownIcon className="w-3 h-3" />
            )}
          </button>
        </td>
        <td className="text-xs font-medium max-w-[150px] truncate">
          {record.property?.address}
        </td>
        <td className="text-xs">
          {record.owner?.name || '-'}
        </td>
        <td className="text-xs font-medium">
          {isPropietario ? (
            <div className="flex items-center gap-1">
              <span className="badge badge-secondary badge-xs">PROP</span>
              <span>{record.owner?.name || 'Propietario'}</span>
            </div>
          ) : (
            record.tenants?.length > 0
              ? record.tenants.map(t => t.name).join(' / ')
              : record.tenant?.name || 'Sin inquilino'
          )}
        </td>
        <td className="text-xs whitespace-nowrap">
          <div className="flex items-center gap-1">
            {record.periodLabel}
            {isPenalty && (
              <span className="badge badge-warning badge-xs">Multa rescisión</span>
            )}
          </div>
        </td>
        <td className="text-xs">
          {record.nextAdjustmentLabel || '-'}
        </td>
        <td className="text-xs text-right font-mono">
          {record.tieneAjuste ? (
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-1">
                {record.alquilerAnterior != null && (
                  <span className="text-[10px] text-base-content/40 line-through">{formatCurrency(record.alquilerAnterior)}</span>
                )}
                <span className="text-[10px]">→</span>
                <span className="font-bold text-primary">{formatCurrency(record.rentAmount)}</span>
              </div>
              <span className="badge badge-primary badge-xs mt-0.5">
                {record.ajustePorcentaje ? `+${record.ajustePorcentaje}%` : 'Ajuste'}
              </span>
            </div>
          ) : (
            formatCurrency(record.rentAmount)
          )}
        </td>
        <td
          className="text-xs text-right font-mono cursor-pointer hover:bg-base-200"
          title={servicesTooltip}
          onClick={() => onToggleRow(record.id)}
        >
          <span className="underline decoration-dotted">
            {formatCurrency(record.servicesTotal)}
          </span>
        </td>
        <td className="text-xs p-1">
          {(!record.comprobantesStatus || record.comprobantesStatus.length === 0) ? (
            <span className="text-base-content/30 text-[10px] block text-center">-</span>
          ) : (
            <div className="flex flex-col gap-1 items-center">
              {record.comprobantesStatus.map(comp => (
                <div 
                  key={comp.id} 
                  className={`flex items-center justify-between w-full px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer transition-colors border ${
                    comp.presented 
                      ? 'bg-success/10 border-success text-success-content dark:text-success' 
                      : 'bg-warning/10 border-warning text-warning-content dark:text-warning hover:bg-warning/20'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleComprobante({ recordId: record.id, conceptTypeId: comp.id, presented: !comp.presented })
                  }}
                  title={comp.presented ? 'Presentado (Click para desmarcar)' : 'Pendiente (Click para marcar)'}
                >
                  <span className="truncate max-w-[65px]">{comp.name}</span>
                  <input
                    type="checkbox"
                    className={`checkbox checkbox-xs rounded-sm ${comp.presented ? 'checkbox-success' : 'checkbox-warning'}`}
                    checked={comp.presented}
                    readOnly
                  />
                </div>
              ))}
            </div>
          )}
        </td>
        {showIvaColumn && (
          <td className="text-xs text-right font-mono">
            {(record.contract?.pagaIva || record.includeIva || ['LOCAL COMERCIAL', 'LOCAL'].includes(record.property?.category?.name)) ? (
              <div className="flex items-center justify-end gap-1">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs checkbox-primary"
                  checked={!!record.includeIva}
                  onChange={(e) => onToggleIva({ recordId: record.id, includeIva: e.target.checked })}
                />
                {record.ivaAmount > 0 && (
                  <span className="text-primary">{formatCurrency(record.ivaAmount)}</span>
                )}
              </div>
            ) : '-'}
          </td>
        )}
        <td className="text-xs text-right font-mono text-info">
          {record.previousBalance > 0
            ? formatCurrency(record.previousBalance)
            : '-'}
        </td>
        <td className="text-[11px] text-right font-mono min-w-[120px]">
          {record.punitoryForgiven ? (
            <span className="text-success font-semibold">Cond.</span>
          ) : (record.punitoriosAnteriores > 0 || record.punitoriosActuales > 0) ? (
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-1.5">
                {record.punitoriosAnteriores > 0 && (
                  <>
                    <div className="flex flex-col items-end" title="Punitorios acumulados atrasados">
                      <span className="text-[9px] text-base-content/50 leading-none uppercase tracking-wider">Acumulados</span>
                      <span className="text-[10px] text-base-content/50">{formatCurrency(record.punitoriosAnteriores)}</span>
                    </div>
                    <span className="text-[10px] text-base-content/30">+</span>
                  </>
                )}
                <div className="flex flex-col items-end text-error">
                  <span className="text-[9px] leading-none opacity-80 uppercase tracking-wider">
                    Actuales {record.livePunitoryDays > 0 ? `(${record.livePunitoryDays}d)` : ''}
                  </span>
                  <span className="font-bold text-sm">{formatCurrency(record.punitoriosActuales)}</span>
                </div>
              </div>
              {(record.punitoriosAnteriores > 0 || record.punitoriosActuales > 0) && (
                <div className="text-[10px] text-error font-bold mt-0.5 pt-0.5 border-t border-error/20 w-fit pl-4">
                  Total: {formatCurrency(record.totalPunitoriosHistoricos || record.livePunitoryAmount)}
                </div>
              )}
            </div>
          ) : record.punitoryAmount > 0 ? (
            <span className="text-error">{formatCurrency(record.punitoryAmount)}</span>
          ) : (
             <span className="text-base-content/30">-</span>
          )}
        </td>
        <td className="text-xs text-right font-mono font-bold">
          {(() => {
            const totalValue = record.totalHistorico || record.liveTotalDue || record.totalDue
            const txs = record.transactions || []
            const recordObs = record.observations
            const txObs = txs
              .map((t, i) => t.observations ? { label: `Pago ${i + 1}`, text: t.observations } : null)
              .filter(Boolean)
            const hasObs = recordObs || txObs.length > 0
            if (!hasObs) return formatCurrency(totalValue)
            return (
              <div className="dropdown dropdown-hover dropdown-bottom dropdown-end">
                <span tabIndex={0} className="cursor-help inline-flex items-center justify-end gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-warning flex-shrink-0"></span>
                  <span className="underline decoration-dotted decoration-base-content/40">{formatCurrency(totalValue)}</span>
                </span>
                <div tabIndex={0} className="dropdown-content z-[100] bg-base-200 border border-base-300 shadow-lg rounded-lg p-2 w-64 mt-1 fixed">
                  <div className="text-[11px] font-semibold mb-1 text-base-content/60">Observaciones</div>
                  {recordObs && (
                    <div className="text-[11px] py-0.5 border-b border-base-300 last:border-0 text-base-content/80">
                      {recordObs}
                    </div>
                  )}
                  {txObs.map((obs, i) => (
                     <div key={i} className="text-[11px] py-0.5 border-b border-base-300 last:border-0">
                      <span className="text-base-content/50">{obs.label}: </span>
                      <span className="text-base-content/80">{obs.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </td>
        <td className="text-xs">
          {(() => {
            const txs = record.transactions || []
            if (txs.length === 0) return '-'
            const lastTx = txs[txs.length - 1]
            return (
              <div className="dropdown dropdown-hover dropdown-bottom dropdown-end">
                <span tabIndex={0} className="cursor-help underline decoration-dotted decoration-base-content/40">
                  {formatDateShort(lastTx.paymentDate)}
                </span>
                <div tabIndex={0} className="dropdown-content z-[100] bg-base-200 border border-base-300 shadow-lg rounded-lg p-2 w-56 mt-1 fixed">
                  <div className="text-[11px] font-semibold mb-1 text-base-content/60">
                    {txs.length === 1 ? '1 pago registrado' : `${txs.length} pagos registrados`}
                  </div>
                  {txs.map((t, i) => (
                    <div key={t.id || i} className="text-[11px] flex justify-between py-0.5 border-b border-base-300 last:border-0">
                      <span>Pago {i + 1}:</span>
                      <span className="font-mono">{formatDateShort(t.paymentDate)} — {t.paymentMethod === 'TRANSFERENCIA' ? 'Transf.' : 'Efect.'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </td>
        <td className="text-xs text-right font-mono">
          {(() => {
            const txs = record.transactions || []
            const totalAbonado = record.totalAbonado || record.amountPaid
            if (txs.length === 0 && totalAbonado <= 0) return '-'
            if (txs.length === 0) return formatCurrency(totalAbonado)
            return (
              <div className="dropdown dropdown-hover dropdown-bottom dropdown-end">
                <span tabIndex={0} className="cursor-help underline decoration-dotted decoration-base-content/40">
                  {formatCurrency(totalAbonado)}
                </span>
                <div tabIndex={0} className="dropdown-content z-[100] bg-base-200 border border-base-300 shadow-lg rounded-lg p-2 w-60 mt-1 fixed">
                  <div className="text-[11px] font-semibold mb-1 text-base-content/60">Detalle de pagos</div>
                  {txs.map((t, i) => (
                     <div key={t.id || i} className="text-[11px] flex justify-between py-0.5 border-b border-base-300 last:border-0">
                      <span>Pago {i + 1} ({formatDateShort(t.paymentDate)}):</span>
                      <span className="font-mono text-success">{formatCurrency(t.amount)}</span>
                    </div>
                  ))}
                  {txs.length > 1 && (
                    <div className="text-[11px] flex justify-between pt-1 font-bold">
                      <span>Total:</span>
                      <span className="font-mono">{formatCurrency(totalAbonado)}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
          {record.balanceForgiven > 0 && (
            <div className="text-[10px] text-warning">Cond. {formatCurrency(record.balanceForgiven)}</div>
          )}
        </td>
        <td className="text-xs text-right font-mono text-success">
          {record.aFavorNextMonth > 1
            ? formatCurrency(record.aFavorNextMonth)
            : '-'}
        </td>
        <td className="text-xs text-right font-mono text-error">
          {record.debeNextMonth > 1
            ? formatCurrency(record.debeNextMonth)
            : '-'}
        </td>
        <td className="text-center">
          <BoolBadge value={record.isCancelled} />
        </td>
        <td className="text-center">
          <BoolBadge value={record.amountPaid > 0} />
        </td>
        <td className="text-center">
          {record.debtInfo && record.debtInfo.status !== 'PAID' ? (
            <div className="flex flex-col items-center gap-0.5">
              <span className="badge badge-sm badge-error">DEUDA</span>
              <span className="text-[10px] font-mono text-error">
                {formatCurrency(record.debtInfo.liveCurrentTotal)}
              </span>
              {record.debtInfo.livePunitoryDays > 0 && (
                <span className="text-[9px] text-error/70">
                  {record.debtInfo.livePunitoryDays}d punt.
                </span>
              )}
            </div>
          ) : record.debtInfo && record.debtInfo.status === 'PAID' ? (
            <span className="badge badge-sm badge-success">SALDADA</span>
          ) : (
            <span className="text-base-content/30">-</span>
          )}
        </td>
        <td className="text-center">
          <div className="flex items-center justify-center gap-1">
          {record.needsRecalculation ? (
            <span className="tooltip tooltip-left" data-tip="Sincronizando mes...">
              <span className="loading loading-spinner loading-xs text-primary"></span>
            </span>
          ) : record.debtInfo && record.debtInfo.status !== 'PAID' ? (
            <>
              <button
                className="btn btn-xs btn-error"
                onClick={() => onDebtPayment(record.debtInfo)}
                title="Pagar deuda"
              >
                <BanknotesIcon className="w-3 h-3" />
              </button>
              <button
                className="btn btn-xs btn-warning btn-outline"
                onClick={() => {
                  if (window.confirm(`¿Condonar deuda de ${record.debtInfo.periodLabel}?`))
                    onForgiveDebt({ debtId: record.debtInfo.id, observations: 'Condonada manualmente' })
                }}
                title="Condonar deuda"
              >
                <NoSymbolIcon className="w-3 h-3" />
              </button>
            </>
          ) : record.status === 'COMPLETE' ? (
            <CheckCircleIcon className="w-4 h-4 text-success" />
          ) : (
             <button
              className="btn btn-xs btn-primary"
              onClick={() => onPayment(record)}
              disabled={record.status === 'COMPLETE'}
              title="Registrar pago"
            >
              <CurrencyDollarIcon className="w-3 h-3" />
            </button>
          )}
          {record.amountPaid > 0 && !record.needsRecalculation && (
            <button
              className="btn btn-xs btn-ghost"
              onClick={() => onTxHistory(record)}
              title="Ver pagos / Anular"
            >
              <EyeIcon className="w-3 h-3" />
            </button>
          )}
          {record.balanceForgiven > 0 && !record.needsRecalculation ? (
            <button
              className="btn btn-xs btn-warning btn-outline"
              onClick={() => {
                if (window.confirm(`¿Revertir condonación de ${formatCurrency(record.balanceForgiven)}?`))
                  onForgiveBalance({ recordId: record.id, forgive: false })
              }}
              title="Revertir condonación"
            >
              <NoSymbolIcon className="w-3 h-3" />
            </button>
          ) : record.status === 'PARTIAL' && !record.debtInfo && record.balance < 0 && !record.needsRecalculation ? (
            <button
              className="btn btn-xs btn-warning btn-outline"
              onClick={() => {
                if (window.confirm(`¿Condonar saldo restante de ${formatCurrency(Math.abs(record.balance))}?`))
                  onForgiveBalance({ recordId: record.id, forgive: true })
              }}
              title="Condonar saldo restante"
            >
              <CheckCircleIcon className="w-3 h-3" />
            </button>
          ) : null}
          {!isPropietario && !record.needsRecalculation && (
            <button
              className="btn btn-xs btn-ghost"
              onClick={() => onNotify(record)}
              title="Avisar inquilino"
            >
              <BellIcon className="w-3 h-3" />
            </button>
          )}
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-base-200/50">
          <td colSpan={showIvaColumn ? 20 : 19} className="p-0">
            <ServiceManagerInline record={record} groupId={groupId} />
          </td>
        </tr>
      )}
    </>
  )
})

// Controlled amount input for an existing service — stays in sync with server value after cache invalidation
function ServiceAmountInput({ service, onUpdate }) {
  const [draft, setDraft] = useState(String(service.amount))
  useEffect(() => {
    setDraft(String(service.amount))
  }, [service.amount, service.id])

  return (
    <input
      type="number"
      className="input input-xs input-bordered w-24"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const val = parseFloat(draft)
        if (!Number.isFinite(val) || val <= 0) return
        if (Math.abs(val - parseFloat(service.amount)) < 0.01) return
        onUpdate(service.id, val)
      }}
    />
  )
}

// Inline Service Manager Component
function ServiceManagerInline({ record, groupId }) {
  const { services, addService, updateService, removeService } = useMonthlyServices(groupId, record.id)
  const [selectedConceptId, setSelectedConceptId] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [propagateForward, setPropagateForward] = useState(false)

  const { data: conceptTypes = [] } = useQuery({
    queryKey: ['conceptTypes', groupId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/payments/concept-types`)
      return response.data.data.filter(ct => ct.isActive)
    },
    enabled: !!groupId,
    staleTime: 60000 // 1 minute
  })

  const handleAddService = () => {
    if (!selectedConceptId || !newAmount) return
    if (propagateForward) {
      const ok = confirm(
        `Se aplicará "${conceptTypes.find(c => c.id === selectedConceptId)?.name}" a este mes y todos los siguientes del año. ¿Continuar?`
      )
      if (!ok) return
    }
    addService({
      conceptTypeId: selectedConceptId,
      amount: parseFloat(newAmount),
      propagateForward,
    })
    setSelectedConceptId('')
    setNewAmount('')
  }

  const handleUpdateService = (serviceId, newAmt) => {
    if (propagateForward) {
      const ok = confirm('Se actualizará este servicio en este mes y todos los siguientes del año. ¿Continuar?')
      if (!ok) return
    }
    updateService({ serviceId, amount: newAmt, propagateForward })
  }

  const handleRemoveService = (serviceId) => {
    const msg = propagateForward
      ? '¿Eliminar este servicio de este mes y todos los meses siguientes del año?'
      : '¿Eliminar este servicio?'
    if (!confirm(msg)) return
    removeService({ serviceId, propagateForward })
  }

  const getCategoryColor = (category) => {
    const colors = {
      IMPUESTO: 'badge-error',
      SERVICIO: 'badge-info',
      GASTO: 'badge-warning',
      DESCUENTO: 'badge-success',
      OTROS: 'badge-ghost'
    }
    return colors[category] || 'badge-ghost'
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <WrenchScrewdriverIcon className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Gestión de Servicios - {record.property?.address}</span>
      </div>

      {services && services.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {services.map((service) => (
             <div key={service.id} className="flex items-center gap-2 bg-base-100 p-2 rounded border border-base-300">
              <span className={`badge badge-sm ${getCategoryColor(service.conceptType?.category)}`}>
                {service.conceptType?.name}
              </span>
              <ServiceAmountInput service={service} onUpdate={handleUpdateService} />
              <button
                className="btn btn-xs btn-ghost text-error"
                onClick={() => handleRemoveService(service.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="select select-sm select-bordered"
          value={selectedConceptId}
          onChange={(e) => setSelectedConceptId(e.target.value)}
        >
          <option value="">+ Agregar servicio...</option>
          {conceptTypes.map((ct) => (
            <option key={ct.id} value={ct.id}>
              {ct.name} ({ct.category})
            </option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Monto"
          className="input input-sm input-bordered w-32"
          value={newAmount}
          onChange={(e) => setNewAmount(e.target.value)}
        />
        <button
          className="btn btn-sm btn-primary"
          onClick={handleAddService}
          disabled={!selectedConceptId || !newAmount}
        >
          Agregar
        </button>
        <label className="flex items-center gap-1 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            className="checkbox checkbox-xs checkbox-primary"
            checked={propagateForward}
            onChange={(e) => setPropagateForward(e.target.checked)}
          />
          Aplicar a meses siguientes
        </label>
      </div>
    </div>
  )
}
