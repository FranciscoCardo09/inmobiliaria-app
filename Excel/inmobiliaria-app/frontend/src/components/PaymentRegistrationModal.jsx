// Payment Registration Modal - Phase 5+
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePaymentTransactions, usePunitoryPreview } from '../hooks/usePaymentTransactions'
import { useCanPayCurrentMonth } from '../hooks/useDebts'
import { useMonthlyRecordDetail } from '../hooks/useMonthlyRecords'
import Modal from './ui/Modal'
import Button from './ui/Button'
import DateInput, { getLocalToday } from './ui/DateInput'
import {
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  NoSymbolIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'

const formatCurrency = (amount) => {
  if (!amount && amount !== 0) return '$0'
  return `$${Math.round(amount).toLocaleString('es-AR')}`
}

function formatDateLocal(dateVal) {
  if (!dateVal) return '-'
  const d = new Date(dateVal)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

// Format number as $100.000 for display in input
const formatInputCurrency = (value) => {
  if (value === '' || value === null || value === undefined) return ''
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return ''
  return '$' + Math.round(num).toLocaleString('es-AR')
}

// Parse a formatted currency string back to a number
const parseInputCurrency = (str) => {
  if (!str) return ''
  // Remove $, dots (thousands sep) and spaces
  const cleaned = str.replace(/[$.\ ]/g, '').replace(/,/g, '.')
  if (cleaned === '' || cleaned === '-') return ''
  const num = parseFloat(cleaned)
  return isNaN(num) ? '' : num
}

export default function PaymentRegistrationModal({ record: recordProp, groupId, onClose }) {
  const navigate = useNavigate()
  const [paymentDate, setPaymentDate] = useState(getLocalToday())
  const [amount, setAmount] = useState('')
  const [displayAmount, setDisplayAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('EFECTIVO')
  const [forgivePunitorios, setForgivePunitorios] = useState(false)
  const [generateReceipt, setGenerateReceipt] = useState(true)
  const [observations, setObservations] = useState('')

  // Get fresh record data in real-time
  const { data: freshRecord } = useMonthlyRecordDetail(groupId, recordProp?.id)
  const record = freshRecord || recordProp

  const { registerPayment, isRegistering } = usePaymentTransactions(groupId)

  // Check if contract is blocked by debts
  const { data: debtCheck, isLoading: isCheckingDebt } = useCanPayCurrentMonth(
    groupId,
    record?.contract?.id
  )
  const isBlocked = debtCheck && !debtCheck.canPay

  // Get punitory preview when date changes
  const { data: punitoryPreview } = usePunitoryPreview(
    groupId,
    record?.id,
    paymentDate
  )

  const punitoryAmount = forgivePunitorios ? 0 : (punitoryPreview?.amount || 0)

  // Calculate total
  const alquiler = record?.rentAmount || 0
  const servicios = record?.servicesTotal || 0
  const aFavorAnterior = record?.previousBalance || 0
  const totalDue = Math.round(alquiler + servicios + punitoryAmount - aFavorAnterior)
  const alreadyPaid = record?.amountPaid || 0
  const remaining = Math.max(totalDue - Math.round(alreadyPaid), 0)

  useEffect(() => {
    setAmount(remaining)
    setDisplayAmount(formatInputCurrency(remaining))
  }, [remaining])

  // Auto-generate receipt for cash payments
  useEffect(() => {
    setGenerateReceipt(paymentMethod === 'EFECTIVO')
  }, [paymentMethod])

  const handleSubmit = async () => {
    if (!amount || amount <= 0) return

    try {
      await registerPayment({
        monthlyRecordId: record.id,
        paymentDate,
        amount: amount,
        paymentMethod,
        forgivePunitorios,
        generateReceipt,
        observations: observations || undefined,
      })
      onClose()
    } catch (e) {
      // Error handled by hook
    }
  }

  const parsedAmount = typeof amount === 'number' ? amount : (parseFloat(amount) || 0)
  const isOverpay = parsedAmount > remaining
  const isPartial = parsedAmount > 0 && parsedAmount < remaining

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Registrar Pago"
      size="lg"
    >
      <div className="space-y-4">
        {/* Contract Info Header */}
        <div className="bg-base-200 rounded-lg p-3">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <span className="text-base-content/60">Inquilino</span>
              <div className="font-semibold">{record?.tenant?.name}</div>
            </div>
            <div>
              <span className="text-base-content/60">Propiedad</span>
              <div className="font-semibold">{record?.property?.address}</div>
            </div>
            <div>
              <span className="text-base-content/60">Período</span>
              <div className="font-semibold">{record?.periodLabel}</div>
            </div>
          </div>
        </div>

        {/* Previous payments info for partial payments */}
        {alreadyPaid > 0 && (
          <div className="bg-info/10 border border-info/30 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <ClockIcon className="w-4 h-4 text-info" />
              <span className="font-semibold text-sm text-info">Pagos anteriores registrados</span>
            </div>
            <div className="space-y-1">
              {(record?.transactions || []).map((tx, i) => (
                <div key={tx.id || i} className="flex justify-between text-sm bg-base-100 rounded px-2 py-1">
                  <span>
                    Pago #{i + 1} — {formatDateLocal(tx.paymentDate)}
                    <span className="text-base-content/50 ml-1 text-xs">
                      ({tx.paymentMethod === 'TRANSFERENCIA' ? 'Transf.' : 'Efectivo'})
                    </span>
                  </span>
                  <span className="font-mono font-semibold text-success">{formatCurrency(tx.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm font-bold pt-1 border-t border-info/20">
                <span>Total abonado</span>
                <span className="font-mono text-success">{formatCurrency(alreadyPaid)}</span>
              </div>
              {punitoryPreview?.lastPaymentDate && (
                <div className="text-xs text-base-content/60 mt-1">
                  Último pago: <strong>{formatDateLocal(punitoryPreview.lastPaymentDate)}</strong>
                </div>
              )}
            </div>
          </div>
        )}

        {/* DEBT BLOCK */}
        {isCheckingDebt && (
          <div className="flex justify-center py-4">
            <span className="loading loading-spinner loading-sm"></span>
            <span className="ml-2 text-sm">Verificando deudas...</span>
          </div>
        )}

        {isBlocked && (
          <div className="bg-error/10 border-2 border-error/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <NoSymbolIcon className="w-6 h-6 text-error" />
              <span className="font-bold text-error text-lg">BLOQUEADO</span>
            </div>
            <p className="text-sm mb-3">
              {record?.tenant?.name} tiene {debtCheck.debts.length} deuda(s) abierta(s):
            </p>
            <div className="space-y-2 mb-4">
              {debtCheck.debts.map((d) => (
                <div key={d.id} className="flex justify-between bg-base-100 p-2 rounded text-sm">
                  <span className="font-medium">{d.periodLabel}</span>
                  <span className="font-mono text-error">{formatCurrency(d.total)}</span>
                </div>
              ))}
            </div>
            <Button
              variant="error"
              size="sm"
              className="w-full"
              onClick={() => { onClose(); navigate('/debts'); }}
            >
              <ExclamationTriangleIcon className="w-4 h-4" />
              Pagar deudas primero
            </Button>
          </div>
        )}

        {/* Breakdown + Form (hidden if blocked) */}
        {!isBlocked && <>
        <div className="bg-base-100 border border-base-300 rounded-lg p-4">
          <h3 className="font-semibold text-sm mb-3">Desglose</h3>

          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Alquiler</span>
              <span className="font-mono">{formatCurrency(alquiler)}</span>
            </div>

            <div className="divider my-1 text-xs">Servicios/Extras</div>

            {record?.services?.length > 0 ? (
              record.services.map((s) => (
                <div key={s.id} className="flex justify-between text-base-content/80">
                  <span className="ml-2">
                    {s.conceptType?.label || s.conceptType?.name}
                  </span>
                  <span className="font-mono">{formatCurrency(s.amount)}</span>
                </div>
              ))
            ) : (
              <div className="text-base-content/50 ml-2 text-xs">Sin servicios</div>
            )}

            <div className="flex justify-between text-base-content/80">
              <span className="font-medium">Subtotal servicios</span>
              <span className="font-mono">{formatCurrency(servicios)}</span>
            </div>

            <div className="divider my-1"></div>

            {/* Punitorios */}
            <div className="flex justify-between">
              <span className={punitoryAmount > 0 ? 'text-error' : ''}>
                Punitorios
                {punitoryPreview?.days > 0 && !forgivePunitorios && (
                  <span className="text-xs text-base-content/50 ml-1">
                    ({punitoryPreview.days} días)
                  </span>
                )}
                {forgivePunitorios && (
                  <span className="text-xs text-success ml-1">(Condonados)</span>
                )}
              </span>
              <span className={`font-mono ${punitoryAmount > 0 ? 'text-error' : ''}`}>
                {forgivePunitorios ? '$0' : formatCurrency(punitoryAmount)}
              </span>
            </div>
            {/* Punitory detail */}
            {punitoryPreview && !forgivePunitorios && (
              <div className="text-[11px] text-base-content/50 ml-2 space-y-0.5">
                <div>Vencimiento: día {punitoryPreview.punitoryGraceDay} ({formatDateLocal(punitoryPreview.graceDate)})</div>
                {punitoryPreview.days > 0 && (
                  <>
                    <div>Tasa diaria: {((punitoryPreview.punitoryPercent || 0) * 100).toFixed(2)}% sobre {formatCurrency(punitoryPreview.unpaidRent != null ? punitoryPreview.unpaidRent : punitoryPreview.baseRent)}</div>
                    {punitoryPreview.fromDate && punitoryPreview.toDate && (
                      <div>Calculados desde <span className="font-semibold">{formatDateLocal(punitoryPreview.fromDate)}</span> hasta <span className="font-semibold">{formatDateLocal(punitoryPreview.toDate)}</span></div>
                    )}
                  </>
                )}
                {punitoryPreview.days === 0 && (
                  <div className="text-success">Pago dentro del plazo — sin punitorios</div>
                )}
              </div>
            )}

            {/* A favor anterior */}
            {aFavorAnterior > 0 && (
              <div className="flex justify-between text-info">
                <span>A favor anterior</span>
                <span className="font-mono">-{formatCurrency(aFavorAnterior)}</span>
              </div>
            )}

            {/* Already paid */}
            {alreadyPaid > 0 && (
              <div className="flex justify-between text-success">
                <span>Ya abonado</span>
                <span className="font-mono">-{formatCurrency(alreadyPaid)}</span>
              </div>
            )}

            <div className="divider my-1"></div>

            <div className="flex justify-between text-lg font-bold">
              <span>RESTANTE A PAGAR</span>
              <span className="font-mono">{formatCurrency(remaining)}</span>
            </div>
          </div>
        </div>

        {/* Form Fields */}
        <div className="grid grid-cols-2 gap-4">
          {/* Payment Date */}
          <div className="form-control">
            <label className="label">
              <span className="label-text text-sm font-medium">
                Fecha de pago
              </span>
            </label>
            <DateInput
              value={paymentDate}
              onChange={setPaymentDate}
              className="input-sm"
            />
          </div>

          {/* Amount */}
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
              className={`input input-bordered input-sm ${
                isPartial ? 'input-warning' : isOverpay ? 'input-info' : ''
              }`}
              value={displayAmount}
              onFocus={(e) => {
                // Show raw number on focus for easy editing
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
                // Format on blur
                setDisplayAmount(formatInputCurrency(amount))
              }}
            />
            {isPartial && (
              <label className="label">
                <span className="label-text-alt text-warning">
                  Pago parcial - faltan {formatCurrency(remaining - parsedAmount)}
                </span>
              </label>
            )}
            {isOverpay && (
              <label className="label">
                <span className="label-text-alt text-info">
                  Excedente a favor: {formatCurrency(parsedAmount - remaining)}
                </span>
              </label>
            )}
          </div>
        </div>

        {/* Payment Method */}
        <div className="form-control">
          <label className="label">
            <span className="label-text text-sm font-medium">Método de pago</span>
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="method"
                className="radio radio-sm radio-primary"
                checked={paymentMethod === 'EFECTIVO'}
                onChange={() => setPaymentMethod('EFECTIVO')}
              />
              <span className="text-sm">Efectivo</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="method"
                className="radio radio-sm radio-primary"
                checked={paymentMethod === 'TRANSFERENCIA'}
                onChange={() => setPaymentMethod('TRANSFERENCIA')}
              />
              <span className="text-sm">Transferencia</span>
            </label>
          </div>
        </div>

        {/* Checkboxes */}
        <div className="flex gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="checkbox checkbox-sm checkbox-success"
              checked={forgivePunitorios}
              onChange={(e) => setForgivePunitorios(e.target.checked)}
            />
            <span className="text-sm">Condonar punitorios</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="checkbox checkbox-sm checkbox-primary"
              checked={generateReceipt}
              onChange={(e) => setGenerateReceipt(e.target.checked)}
            />
            <span className="text-sm">Generar recibo</span>
          </label>
        </div>

        {/* Observations */}
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
        </>}
      </div>

      {/* Actions */}
      <div className="modal-action">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        {!isBlocked && (
          <Button
            variant="primary"
            size="sm"
            loading={isRegistering}
            onClick={handleSubmit}
            disabled={!amount || parseFloat(amount) <= 0}
          >
            <CurrencyDollarIcon className="w-4 h-4" />
            Registrar Pago
          </Button>
        )}
      </div>
    </Modal>
  )
}
