// Transaction History Modal - View and void/delete payment transactions
import { useState } from 'react'
import { usePaymentTransactions } from '../hooks/usePaymentTransactions'
import Modal from './ui/Modal'
import Button from './ui/Button'
import {
  TrashIcon,
  BanknotesIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  ReceiptPercentIcon,
} from '@heroicons/react/24/outline'

const formatCurrency = (amount) => {
  if (!amount && amount !== 0) return '$0'
  return `$${Math.round(amount).toLocaleString('es-AR')}`
}

const methodLabels = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
}

export default function TransactionHistoryModal({ record, groupId, onClose }) {
  const [confirmDelete, setConfirmDelete] = useState(null)

  const { transactions, isLoading, deleteTransaction, isDeleting } =
    usePaymentTransactions(groupId, {
      contractId: record?.contract?.id,
      month: record?.periodMonth,
      year: record?.periodYear,
    })

  // Filter only transactions for this specific monthly record
  const recordTransactions = (transactions || []).filter(
    (t) => t.monthlyRecordId === record?.id
  )

  const handleDelete = (txId) => {
    deleteTransaction(txId)
    setConfirmDelete(null)
  }

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <BanknotesIcon className="w-5 h-5" />
          Historial de Pagos
        </div>
      }
      size="lg"
    >
      <div className="space-y-4">
        {/* Record Info */}
        <div className="bg-base-200 rounded-lg p-3 text-sm">
          <div className="grid grid-cols-3 gap-2">
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
          <div className="flex justify-between mt-2 pt-2 border-t border-base-300">
            <span>Total adeudado: <strong>{formatCurrency(record?.liveTotalDue || record?.totalDue)}</strong></span>
            <span>Abonado: <strong className="text-success">{formatCurrency(record?.amountPaid)}</strong></span>
          </div>
        </div>

        {/* Transactions List */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <span className="loading loading-spinner loading-md"></span>
          </div>
        ) : recordTransactions.length === 0 ? (
          <div className="text-center py-8 text-base-content/50">
            <ClockIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>No hay pagos registrados para este período</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recordTransactions.map((tx, idx) => (
              <div
                key={tx.id}
                className="border border-base-300 rounded-lg overflow-hidden"
              >
                {/* Transaction header */}
                <div className="flex items-center justify-between bg-base-100 p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col">
                      <span className="text-xs text-base-content/50">
                        Pago #{idx + 1}
                      </span>
                      <span className="font-semibold text-lg font-mono">
                        {formatCurrency(tx.amount)}
                      </span>
                    </div>
                    <div className="flex flex-col text-sm">
                      <span className="flex items-center gap-1">
                        <ClockIcon className="w-3 h-3" />
                        {new Date(tx.paymentDate).toLocaleDateString('es-AR')}
                      </span>
                      <span className="badge badge-sm badge-ghost">
                        {methodLabels[tx.paymentMethod] || tx.paymentMethod}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {tx.receiptNumber && (
                      <span className="flex items-center gap-1 text-xs text-base-content/50">
                        <ReceiptPercentIcon className="w-3 h-3" />
                        {tx.receiptNumber}
                      </span>
                    )}
                    {confirmDelete === tx.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-error font-medium">¿Anular?</span>
                        <button
                          className="btn btn-xs btn-error"
                          onClick={() => handleDelete(tx.id)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? (
                            <span className="loading loading-spinner loading-xs"></span>
                          ) : (
                            'Sí'
                          )}
                        </button>
                        <button
                          className="btn btn-xs btn-ghost"
                          onClick={() => setConfirmDelete(null)}
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn-xs btn-outline btn-error"
                        onClick={() => setConfirmDelete(tx.id)}
                        title="Anular este pago"
                      >
                        <TrashIcon className="w-3 h-3" />
                        Anular
                      </button>
                    )}
                  </div>
                </div>

                {/* Concepts breakdown */}
                {tx.concepts && tx.concepts.length > 0 && (
                  <div className="bg-base-200/50 px-3 py-2 border-t border-base-300">
                    <div className="text-xs text-base-content/50 mb-1">Desglose:</div>
                    <div className="space-y-0.5">
                      {tx.concepts.map((c) => (
                        <div key={c.id} className="flex justify-between text-xs">
                          <span className="text-base-content/70">
                            {c.type}
                            {c.description && (
                              <span className="text-base-content/40 ml-1">
                                — {c.description}
                              </span>
                            )}
                          </span>
                          <span className={`font-mono ${c.amount < 0 ? 'text-success' : ''}`}>
                            {c.amount < 0 ? '-' : ''}{formatCurrency(Math.abs(c.amount))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Punitory info */}
                {tx.punitoryForgiven && (
                  <div className="px-3 py-1 bg-success/10 border-t border-base-300">
                    <span className="text-xs text-success">✓ Punitorios condonados</span>
                  </div>
                )}

                {/* Observations */}
                {tx.observations && (
                  <div className="px-3 py-1 bg-base-200/30 border-t border-base-300">
                    <span className="text-xs text-base-content/60">
                      Obs: {tx.observations}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Warning */}
        {recordTransactions.length > 0 && (
          <div className="flex items-start gap-2 text-xs text-warning bg-warning/10 rounded-lg p-3">
            <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <strong>Anular un pago</strong> elimina la transacción y recalcula automáticamente
              el estado del registro mensual (totales, estado de pago, saldo a favor).
            </div>
          </div>
        )}
      </div>

      <div className="modal-action">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </Modal>
  )
}
