// Debt Payment Modal - Pay open debts
import { useState, useEffect } from 'react'
import Modal from './ui/Modal'
import Button from './ui/Button'
import {
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import DateInput, { getLocalToday } from './ui/DateInput'
import { useDebtPunitoryPreview, useDebts, useDebt } from '../hooks/useDebts'
import toast from 'react-hot-toast'

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

const formatDateLocal = (dateStr) => {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const year = d.getUTCFullYear()
  return `${day}/${month}/${year}`
}

export default function DebtPaymentModal({ debt: debtProp, groupId, onPay, isPaying, onClose }) {
  const today = getLocalToday()

  const [paymentDate, setPaymentDate] = useState(today)
  const [amount, setAmount] = useState('')
  const [displayAmount, setDisplayAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('EFECTIVO')
  const [observations, setObservations] = useState('')
  const [cancelingPaymentId, setCancelingPaymentId] = useState(null)

  // Fetch fresh debt data from the server (auto-updates after payments)
  const { data: freshDebt } = useDebt(groupId, debtProp?.id)
  const debt = freshDebt || debtProp

  // Recalculate punitorios when date changes
  const { data: preview } = useDebtPunitoryPreview(groupId, debt?.id, paymentDate)
  const { cancelPayment, isCancelingPayment } = useDebts(groupId)

  // Use preview data when available, fallback to debt data
  const unpaidRent = preview?.remainingDebt ?? Math.max((debt?.unpaidRentAmount || 0) - (debt?.amountPaid || 0), 0)
  const accumulatedPunitory = preview?.accumulatedPunitory ?? (debt?.accumulatedPunitory || 0)
  const newPunitoryAmount = preview?.newPunitoryAmount ?? 0
  const totalPunitory = preview?.amount ?? (debt?.liveAccumulatedPunitory || 0)
  const punitoryDays = preview?.days ?? (debt?.livePunitoryDays || 0)
  const totalToPay = preview?.totalToPay ?? (debt?.liveCurrentTotal || (unpaidRent + totalPunitory))
  const punitoryFrom = preview?.fromDate ?? debt?.punitoryFromDate
  const punitoryTo = preview?.toDate ?? debt?.punitoryToDate

  // Default amount to total
  useEffect(() => {
    const rounded = Math.round(totalToPay)
    setAmount(rounded)
    setDisplayAmount(formatInputCurrency(rounded))
  }, [totalToPay])

  const handleSubmit = async () => {
    if (!amount || amount <= 0) return

    try {
      await onPay({
        debtId: debt.id,
        amount: amount,
        paymentDate,
        paymentMethod,
        observations: observations || undefined,
      })
      onClose()
    } catch (e) {
      // Error handled by hook
    }
  }

  const handleCancelPayment = async (paymentId) => {
    if (!window.confirm('¿Está seguro que desea anular este pago? Se revertirán los cambios en la deuda.')) {
      return
    }

    try {
      setCancelingPaymentId(paymentId)
      await cancelPayment({ debtId: debt.id, paymentId })
      // No cerrar el modal - los datos se actualizarán automáticamente
      // y el usuario podrá ver el siguiente pago disponible para anular
    } catch (e) {
      // Error handled by hook
    } finally {
      setCancelingPaymentId(null)
    }
  }

  const parsedAmount = typeof amount === 'number' ? amount : (parseFloat(amount) || 0)
  // Considerar pago completo si la diferencia es menor a $1 (tolerancia por redondeo)
  const difference = totalToPay - parsedAmount
  const isPartial = parsedAmount > 0 && difference > 1

  return (
    <Modal isOpen={true} onClose={onClose} title="Pagar Deuda" size="lg">
      <div className="space-y-4">
        {/* Debt Info */}
        <div className="bg-error/5 border border-error/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-error" />
            <span className="font-bold text-error">Deuda: {debt?.periodLabel}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-base-content/60">Inquilino</span>
              <div className="font-semibold">{debt?.contract?.tenant?.name}</div>
            </div>
            <div>
              <span className="text-base-content/60">Propiedad</span>
              <div className="font-semibold">{debt?.contract?.property?.address}</div>
            </div>
          </div>
        </div>

        {/* Breakdown */}
        <div className="bg-base-100 border border-base-300 rounded-lg p-4">
          <h3 className="font-semibold text-sm mb-3">Desglose</h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Monto original adeudado</span>
              <span className="font-mono">{formatCurrency(debt?.originalAmount)}</span>
            </div>
            <div className="flex justify-between text-success">
              <span>Ya pagado (antes de cerrar)</span>
              <span className="font-mono">-{formatCurrency(debt?.previousRecordPayment || 0)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>Deuda base restante</span>
              <span className="font-mono">{formatCurrency(unpaidRent)}</span>
            </div>

            {/* Punitorios del período (congelados) */}
            {accumulatedPunitory > 0 && (
              <div className="flex justify-between text-error">
                <span>
                  Punitorios del período
                  <span className="text-xs text-base-content/50 ml-1">(acumulados)</span>
                </span>
                <span className="font-mono text-error">{formatCurrency(accumulatedPunitory)}</span>
              </div>
            )}

            <div className="divider my-1"></div>

            {/* Nuevos punitorios sobre saldo pendiente */}
            {newPunitoryAmount > 0 && (
              <>
                <div className="flex justify-between text-error">
                  <span>
                    Nuevos punitorios
                    {punitoryDays > 0 && (
                      <span className="text-xs text-base-content/50 ml-1">
                        ({punitoryDays} días al {(debt.punitoryPercent * 100).toFixed(1)}% diario)
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-error">{formatCurrency(newPunitoryAmount)}</span>
                </div>
                {punitoryFrom && punitoryTo && (
                  <div className="flex items-center gap-1 text-xs text-base-content/60 mt-1">
                    <ClockIcon className="w-3.5 h-3.5" />
                    <span>
                      Desde <span className="font-semibold">{formatDateLocal(punitoryFrom)}</span> hasta <span className="font-semibold">{formatDateLocal(punitoryTo)}</span>
                    </span>
                  </div>
                )}
              </>
            )}

            <div className="divider my-1"></div>

            <div className="flex justify-between text-lg font-bold">
              <span>TOTAL A PAGAR</span>
              <span className="font-mono text-error">{formatCurrency(totalToPay)}</span>
            </div>
          </div>
        </div>

        {/* Payment history */}
        {debt?.payments?.length > 0 && (
          <div className="bg-base-200/50 rounded-lg p-3">
            <h4 className="text-xs font-semibold mb-2 uppercase tracking-wide text-base-content/60">
              Pagos anteriores
            </h4>
            {debt.payments.map((p, idx) => {
              const isLastPayment = idx === debt.payments.length - 1
              return (
                <div key={p.id} className="flex justify-between items-center text-xs py-1 group hover:bg-base-300/30 px-2 rounded">
                  <span>{formatDateLocal(p.paymentDate)} — {p.paymentMethod || 'Efectivo'}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-success">{formatCurrency(p.amount)}</span>
                    {isLastPayment && (
                      <button
                        type="button"
                        disabled={isCancelingPayment && cancelingPaymentId === p.id}
                        onClick={() => handleCancelPayment(p.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-error/20 rounded text-error disabled:opacity-50"
                        title="Anular este pago (solo el último)"
                      >
                        {isCancelingPayment && cancelingPaymentId === p.id ? (
                          <div className="loading loading-spinner loading-xs"></div>
                        ) : (
                          <TrashIcon className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Form */}
        <div className="grid grid-cols-2 gap-4">
          <div className="form-control">
            <label className="label">
              <span className="label-text text-sm font-medium">
                Fecha de pago
              </span>
            </label>
            <DateInput
              className="input-sm"
              value={paymentDate}
              onChange={setPaymentDate}
            />
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
              className={`input input-bordered input-sm ${isPartial ? 'input-warning' : ''}`}
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
            {isPartial && (
              <label className="label">
                <span className="label-text-alt text-warning">
                  Pago parcial - queda {formatCurrency(totalToPay - parsedAmount)}
                </span>
              </label>
            )}
          </div>
        </div>

        {/* Payment Method */}
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
            placeholder="Notas sobre el pago de deuda..."
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
          disabled={!amount || amount <= 0}
        >
          <CurrencyDollarIcon className="w-4 h-4" />
          Pagar Deuda
        </Button>
      </div>
    </Modal>
  )
}
