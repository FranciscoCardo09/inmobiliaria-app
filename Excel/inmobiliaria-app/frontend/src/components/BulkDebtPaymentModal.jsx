// Bulk Debt Payment Modal - Pagar varios meses adeudados de un inquilino de una sola vez.
// El monto ingresado se reparte en orden cronológico (más viejo → más nuevo, "waterfall").
import { useState, useEffect, useMemo } from 'react'
import Modal from './ui/Modal'
import Button from './ui/Button'
import {
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'
import DateInput, { getLocalToday } from './ui/DateInput'
import { useBulkDebtPreview } from '../hooks/useDebts'

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

export default function BulkDebtPaymentModal({ debts, groupId, onPay, isPaying, onClose }) {
  const today = getLocalToday()

  const [paymentDate, setPaymentDate] = useState(today)
  const [amount, setAmount] = useState('')
  const [displayAmount, setDisplayAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('EFECTIVO')
  const [observations, setObservations] = useState('')

  const debtIds = useMemo(() => debts.map((d) => d.id), [debts])

  // Datos comunes (mismo inquilino/contrato)
  const tenantName = debts[0]?.contract?.tenant?.name
  const propertyAddress = debts[0]?.contract?.property?.address

  // Preview por mes recalculado a la fecha de pago elegida
  const { data: preview, isLoading: isPreviewLoading, error: previewError } = useBulkDebtPreview(
    groupId,
    debtIds,
    paymentDate
  )

  // Items ordenados más viejo → más nuevo, recalculados a la fecha de pago.
  // Fallback a datos de la deuda mientras carga el preview.
  const items = useMemo(() => {
    if (preview?.debts) return preview.debts
    return [...debts]
      .sort((a, b) => (a.periodYear - b.periodYear) || (a.periodMonth - b.periodMonth))
      .map((d) => ({
        id: d.id,
        periodLabel: d.periodLabel,
        totalToPay: d.liveCurrentTotal ?? 0,
        remainingRent: d.unpaidRentAmount ?? 0,
        remainingServices: d.unpaidServicesAmount ?? 0,
        punitory: d.liveAccumulatedPunitory ?? 0,
        punitoryDays: d.livePunitoryDays ?? 0,
      }))
  }, [preview, debts])

  const total = useMemo(
    () => items.reduce((s, it) => s + (it.totalToPay || 0), 0),
    [items]
  )

  // Default: monto = total
  useEffect(() => {
    const rounded = Math.round(total)
    setAmount(rounded)
    setDisplayAmount(formatInputCurrency(rounded))
  }, [total])

  const parsedAmount = typeof amount === 'number' ? amount : (parseFloat(amount) || 0)

  // Waterfall en vivo: repartir el monto entre los meses en orden.
  const allocation = useMemo(() => {
    let remaining = parsedAmount
    const rows = items.map((it) => {
      const applied = Math.min(Math.max(remaining, 0), it.totalToPay || 0)
      remaining = remaining - applied
      const pending = (it.totalToPay || 0) - applied
      let status = 'NONE'
      if (applied <= 0.5) status = 'NONE'
      else if (pending <= 1) status = 'FULL'
      else status = 'PARTIAL'
      return { ...it, applied, pending, status }
    })
    const overpay = Math.max(remaining, 0)
    return { rows, overpay }
  }, [items, parsedAmount])

  const handleSubmit = async () => {
    if (!parsedAmount || parsedAmount <= 0) return
    try {
      await onPay({
        debtIds, // el backend reordena, pero los enviamos igual
        amount: parsedAmount,
        paymentDate,
        paymentMethod,
        observations: observations || undefined,
      })
      onClose()
    } catch (e) {
      // Error manejado por el hook
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title="Pagar varias deudas" size="lg">
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

        {/* Detalle por mes con preview del reparto */}
        <div className="bg-base-100 border border-base-300 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Detalle por mes</h3>
            {isPreviewLoading && <span className="loading loading-spinner loading-xs"></span>}
          </div>
          <div className="overflow-x-auto">
            <table className="table table-xs">
              <thead>
                <tr>
                  <th>Período</th>
                  <th className="text-right">Total mes</th>
                  <th className="text-right">A aplicar</th>
                  <th className="text-center">Estado</th>
                </tr>
              </thead>
              <tbody>
                {allocation.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium whitespace-nowrap">{row.periodLabel}</td>
                    <td className="text-right font-mono">{formatCurrency(row.totalToPay)}</td>
                    <td className="text-right font-mono text-success">
                      {row.applied > 0.5 ? formatCurrency(row.applied) : '-'}
                    </td>
                    <td className="text-center">
                      {row.status === 'FULL' && (
                        <span className="badge badge-success badge-sm gap-1">
                          <CheckCircleIcon className="w-3 h-3" /> Completo
                        </span>
                      )}
                      {row.status === 'PARTIAL' && (
                        <span className="badge badge-warning badge-sm">
                          Parcial · queda {formatCurrency(row.pending)}
                        </span>
                      )}
                      {row.status === 'NONE' && (
                        <span className="badge badge-ghost badge-sm">Sin cubrir</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t border-base-300">
                  <td>TOTAL</td>
                  <td className="text-right font-mono text-error">{formatCurrency(total)}</td>
                  <td className="text-right font-mono text-success">
                    {formatCurrency(Math.min(parsedAmount, total))}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          {allocation.overpay > 1 && (
            <div className="text-xs text-info mt-2">
              Excedente de {formatCurrency(allocation.overpay)} → quedará como saldo a favor del último mes.
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
          loading={isPaying}
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
