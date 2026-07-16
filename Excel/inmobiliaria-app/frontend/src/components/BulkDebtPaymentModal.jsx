// Bulk Debt Payment Modal - Pagar varios meses adeudados de un inquilino de una sola vez,
// opcionalmente incluyendo el mes actual como último eslabón del waterfall.
// El monto ingresado se reparte en orden cronológico (más viejo → más nuevo, "waterfall").
import { useState, useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'
import Modal from './ui/Modal'
import Button from './ui/Button'
import {
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'
import DateInput, { getLocalToday } from './ui/DateInput'
import { useBulkDebtPreview } from '../hooks/useDebts'
import api from '../services/api'

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const formatCurrency = (amount) => {
  if (!amount && amount !== 0) return '$0'
  return `$${Math.round(amount).toLocaleString('es-AR')}`
}

const formatInputCurrency = (value) => {
  if (value === '' || value === null || value === undefined) return ''
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return ''
  return '$' + Math.round(num).toLocaleString('es-AR')
}

// Fila de concepto dentro del desglose de un mes.
function ConceptRow({ label, value, className = '', hideIfZero = false }) {
  if (hideIfZero && !(value > 0)) return null
  return (
    <div className={`flex justify-between text-xs ${className}`}>
      <span>{label}</span>
      <span className="font-mono">{formatCurrency(value)}</span>
    </div>
  )
}

export default function BulkDebtPaymentModal({ debts, groupId, currentRecord = null, onPay, isPaying, onClose }) {
  const today = getLocalToday()

  const [paymentDate, setPaymentDate] = useState(today)
  const [amount, setAmount] = useState('')
  const [displayAmount, setDisplayAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('EFECTIVO')
  const [forgivePunitorios, setForgivePunitorios] = useState(false)
  const [observations, setObservations] = useState('')
  const [isDownloadingReceipt, setIsDownloadingReceipt] = useState(false)

  const debtIds = useMemo(() => debts.map((d) => d.id), [debts])
  const currentRecordId = currentRecord?.id || null

  // Datos comunes (mismo inquilino/contrato)
  const tenantName = debts[0]?.contract?.tenant?.name || currentRecord?.contract?.tenant?.name
  const propertyAddress = debts[0]?.contract?.property?.address || currentRecord?.contract?.property?.address

  // Preview por mes recalculado a la fecha de pago elegida (incluye el mes actual si se pasó)
  const { data: preview, isLoading: isPreviewLoading, error: previewError } = useBulkDebtPreview(
    groupId,
    debtIds,
    paymentDate,
    currentRecordId
  )

  // Items ordenados más viejo → más nuevo, con desglose por concepto, recalculados a la
  // fecha de pago. Fallback a datos crudos mientras carga el preview.
  const items = useMemo(() => {
    if (preview?.debts) return preview.debts
    // `debts` puede venir con dos shapes distintas según quién abrió el modal:
    // DebtList (getOpenDebts: liveCurrentTotal/unpaidRentAmount/...) o el cartel de
    // PaymentRegistrationModal (canPayCurrentMonth: total/remainingDebt/punitory).
    // Se soportan ambas mientras carga el preview real (spinner visible mientras tanto).
    const fallback = [...debts]
      .sort((a, b) => (a.periodYear - b.periodYear) || (a.periodMonth - b.periodMonth))
      .map((d) => ({
        type: 'DEBT',
        id: d.id,
        periodLabel: d.periodLabel,
        totalToPay: d.liveCurrentTotal ?? d.total ?? 0,
        remainingRent: d.unpaidRentAmount ?? d.remainingDebt ?? 0,
        // d.remainingServices/d.iva ya vienen desglosados (getOpenDebts →
        // computeLiveDebtTotal → calculateDebtPunitory). Fallback a
        // unpaidServicesAmount (bundle IVA+servicios) solo si `d` viene de un shape
        // más viejo que todavía no los expone.
        remainingServices: d.remainingServices ?? d.unpaidServicesAmount ?? 0,
        iva: d.iva ?? 0,
        punitory: d.liveAccumulatedPunitory ?? d.punitory ?? 0,
        punitoryDays: d.livePunitoryDays ?? 0,
      }))
    if (currentRecord) {
      fallback.push({
        type: 'RECORD',
        id: currentRecord.id,
        periodLabel: currentRecord.periodLabel || `${MONTH_NAMES[(currentRecord.periodMonth || 1) - 1]} ${currentRecord.periodYear} (mes actual)`,
        totalToPay: 0,
        remainingRent: currentRecord.rentAmount || 0,
        remainingServices: Math.max(currentRecord.servicesTotal || 0, 0),
        iva: currentRecord.ivaAmount || 0,
        punitory: 0,
        previousBalance: currentRecord.previousBalance || 0,
      })
    }
    return fallback
  }, [preview, debts, currentRecord])

  // Total efectivo a pagar de un mes: si se condona, el punitorio no cuenta (igual
  // criterio que el backend — ver debtService.payDebtsBulk, que topea cada deuda sin
  // punitorio cuando forgivePunitorios=true para no dejarla con sobrepago/saldo a favor).
  const effectiveTotal = (it) => {
    const raw = it.totalToPay || 0
    return forgivePunitorios ? Math.max(raw - (it.punitory || 0), 0) : raw
  }

  const total = useMemo(
    () => items.reduce((s, it) => s + effectiveTotal(it), 0),
    [items, forgivePunitorios]
  )

  // Default: monto = total
  useEffect(() => {
    const rounded = Math.round(total)
    setAmount(rounded)
    setDisplayAmount(formatInputCurrency(rounded))
  }, [total])

  const parsedAmount = typeof amount === 'number' ? amount : (parseFloat(amount) || 0)

  // Waterfall en vivo: repartir el monto entre los meses en orden. El último ítem (mes
  // actual, si está presente) es el único que puede quedar con excedente ("saldo a
  // favor"); las deudas nunca lo reciben (se topean a su total efectivo).
  const allocation = useMemo(() => {
    let remaining = parsedAmount
    const rows = items.map((it) => {
      const cap = effectiveTotal(it)
      const applied = Math.min(Math.max(remaining, 0), cap)
      remaining = remaining - applied
      const pending = cap - applied
      let status = 'NONE'
      if (applied <= 0.5) status = 'NONE'
      else if (pending <= 1) status = 'FULL'
      else status = 'PARTIAL'
      return { ...it, totalToPay: cap, applied, pending, status }
    })
    const overpay = Math.max(remaining, 0)
    return { rows, overpay }
  }, [items, parsedAmount, forgivePunitorios])

  const handleSubmit = async () => {
    if (!parsedAmount || parsedAmount <= 0) return
    try {
      const result = await onPay({
        debtIds, // el backend reordena, pero los enviamos igual
        amount: parsedAmount,
        paymentDate,
        paymentMethod,
        forgivePunitorios,
        currentRecordId: currentRecordId || undefined,
        observations: observations || undefined,
      })

      // Recibo combinado: un único PDF con todos los meses efectivamente pagados.
      const paidMonthlyRecordIds = result?.result?.paidMonthlyRecordIds
      if (paymentMethod === 'EFECTIVO' && paidMonthlyRecordIds?.length > 0) {
        setIsDownloadingReceipt(true)
        try {
          const response = await api.post(
            `/groups/${groupId}/reports/pago-efectivo/pdf/multi`,
            { monthlyRecordIds: paidMonthlyRecordIds },
            { responseType: 'blob' }
          )
          const blob = new Blob([response.data], { type: 'application/pdf' })
          const url = window.URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = `recibos-${(tenantName || 'pago').toLowerCase().replace(/\s/g, '-')}.pdf`
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          window.URL.revokeObjectURL(url)
          toast.success('Recibo combinado descargado')
        } catch (pdfErr) {
          console.error('Error descargando recibo combinado:', pdfErr)
          toast.error('Pago registrado pero no se pudo descargar el recibo')
        } finally {
          setIsDownloadingReceipt(false)
        }
      }

      onClose()
    } catch (e) {
      // Error manejado por el hook
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title="Pagar varias" size="lg">
      <div className="space-y-4">
        {/* Inquilino / Propiedad */}
        <div className="bg-error/5 border border-error/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-error" />
            <span className="font-bold text-error">{items.length} meses seleccionados</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-base-content/60">Inquilino</span>
              <div className="font-semibold">{tenantName}</div>
            </div>
            <div>
              <span className="text-base-content/60">Propiedad</span>
              <div className="font-semibold">{propertyAddress}</div>
            </div>
          </div>
        </div>

        {previewError && (
          <div className="alert alert-error text-sm">
            <ExclamationTriangleIcon className="w-5 h-5" />
            <span>{previewError.response?.data?.message || 'No se pudo calcular el detalle'}</span>
          </div>
        )}

        {/* Desglose por mes y por concepto, con el reparto (waterfall) del monto ingresado */}
        <div className="bg-base-100 border border-base-300 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Desglose por mes</h3>
            {isPreviewLoading && <span className="loading loading-spinner loading-xs"></span>}
          </div>
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {allocation.rows.map((row) => (
              <div key={row.id} className={`border rounded-lg p-3 ${row.type === 'RECORD' ? 'border-info/40 bg-info/5' : 'border-base-300'}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-medium text-sm">
                    {row.periodLabel}
                    {row.type === 'RECORD' && <span className="ml-1 text-[10px] text-info font-normal">(mes actual)</span>}
                  </span>
                  {row.status === 'FULL' && (
                    <span className="badge badge-success badge-sm gap-1">
                      <CheckCircleIcon className="w-3 h-3" /> Completo
                    </span>
                  )}
                  {row.status === 'PARTIAL' && (
                    <span className="badge badge-warning badge-sm">Parcial · queda {formatCurrency(row.pending)}</span>
                  )}
                  {row.status === 'NONE' && (
                    <span className="badge badge-ghost badge-sm">Sin cubrir</span>
                  )}
                </div>

                <div className="space-y-0.5">
                  <ConceptRow label="Alquiler" value={row.remainingRent} />
                  <ConceptRow label="Servicios" value={row.remainingServices} hideIfZero />
                  <ConceptRow label="IVA" value={row.iva} hideIfZero />
                  {row.punitory > 0 && (
                    <ConceptRow
                      label={forgivePunitorios ? 'Punitorios (condonados)' : `Punitorios${row.punitoryDays > 0 ? ` (${row.punitoryDays} días)` : ''}`}
                      value={forgivePunitorios ? 0 : row.punitory}
                      className={!forgivePunitorios ? 'text-error' : ''}
                    />
                  )}
                  {row.type === 'RECORD' && row.previousBalance > 0 && (
                    <ConceptRow label="A favor anterior" value={-row.previousBalance} className="text-info" />
                  )}
                </div>

                <div className="divider my-1"></div>
                <div className="flex justify-between text-sm font-semibold">
                  <span>Total del mes</span>
                  <span className="font-mono">{formatCurrency(row.totalToPay)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-base-content/60">A aplicar</span>
                  <span className="font-mono text-success">{row.applied > 0.5 ? formatCurrency(row.applied) : '-'}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="divider my-2"></div>
          <div className="flex justify-between font-bold">
            <span>TOTAL</span>
            <span className="font-mono text-error">{formatCurrency(total)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-base-content/60">A aplicar</span>
            <span className="font-mono text-success">{formatCurrency(Math.min(parsedAmount, total))}</span>
          </div>

          {allocation.overpay > 1 && (
            <div className="text-xs text-info mt-2">
              {currentRecord
                ? `Excedente de ${formatCurrency(allocation.overpay)} → queda como saldo a favor del mes actual.`
                : `Excedente de ${formatCurrency(allocation.overpay)} → quedará como saldo a favor del último mes.`}
            </div>
          )}
        </div>

        {/* Form */}
        <div className="grid grid-cols-2 gap-4">
          <div className="form-control">
            <label className="label">
              <span className="label-text text-sm font-medium">Fecha de pago</span>
            </label>
            <DateInput className="input-sm" value={paymentDate} onChange={setPaymentDate} />
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text text-sm font-medium">
                <CurrencyDollarIcon className="w-4 h-4 inline mr-1" />
                Monto a pagar
              </span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              className="input input-bordered input-sm"
              value={displayAmount}
              onFocus={(e) => {
                setDisplayAmount(amount ? amount.toString() : '')
                setTimeout(() => e.target.select(), 0)
              }}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9]/g, '')
                setDisplayAmount(raw)
                const num = parseInt(raw, 10)
                setAmount(isNaN(num) ? '' : num)
              }}
              onBlur={() => {
                setDisplayAmount(formatInputCurrency(amount))
              }}
            />
          </div>
        </div>

        {/* Método de pago */}
        <div className="form-control">
          <label className="label">
            <span className="label-text text-sm font-medium">Metodo de pago</span>
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                className="radio radio-sm radio-primary"
                checked={paymentMethod === 'EFECTIVO'}
                onChange={() => setPaymentMethod('EFECTIVO')}
              />
              <span className="text-sm">Efectivo</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                className="radio radio-sm radio-primary"
                checked={paymentMethod === 'TRANSFERENCIA'}
                onChange={() => setPaymentMethod('TRANSFERENCIA')}
              />
              <span className="text-sm">Transferencia</span>
            </label>
          </div>
        </div>

        {/* Condonar punitorios (aplica a TODOS los meses del pago múltiple) */}
        <div className="form-control">
          <label className="label cursor-pointer justify-start gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={forgivePunitorios}
              onChange={(e) => setForgivePunitorios(e.target.checked)}
            />
            <span className="label-text text-sm">Condonar punitorios (aplica a todos los meses)</span>
          </label>
        </div>

        <div className="form-control">
          <label className="label">
            <span className="label-text text-sm">Observaciones</span>
          </label>
          <textarea
            className="textarea textarea-bordered textarea-sm"
            rows="2"
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            placeholder="Notas sobre el pago..."
          />
        </div>
      </div>

      <div className="modal-action">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={isPaying || isDownloadingReceipt}
          onClick={handleSubmit}
          disabled={!parsedAmount || parsedAmount <= 0 || isPreviewLoading}
        >
          <CurrencyDollarIcon className="w-4 h-4" />
          Registrar pago
        </Button>
      </div>
    </Modal>
  )
}
