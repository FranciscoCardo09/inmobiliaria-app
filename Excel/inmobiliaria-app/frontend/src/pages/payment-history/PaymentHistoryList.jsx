// Payment History List - Phase 5
import { useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { usePaymentTransactions } from '../../hooks/usePaymentTransactions'
import Card from '../../components/ui/Card'
import { LoadingPage } from '../../components/ui/Loading'
import EmptyState from '../../components/ui/EmptyState'
import {
  ClockIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ReceiptPercentIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline'

const monthNames = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const formatCurrency = (amount) => {
  if (!amount && amount !== 0) return '$0'
  return `$${Math.round(amount).toLocaleString('es-AR')}`
}

export default function PaymentHistoryList() {
  const currentGroupId = useAuthStore((s) => s.currentGroupId)
  const now = new Date()

  const [month, setMonth] = useState('')
  const [year, setYear] = useState(now.getFullYear().toString())
  const [methodFilter, setMethodFilter] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  const { transactions, total, isLoading } = usePaymentTransactions(
    currentGroupId,
    { month, year, paymentMethod: methodFilter }
  )

  if (isLoading) return <LoadingPage />

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ClockIcon className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Historial de Pagos</h1>
          <p className="text-sm text-base-content/60">
            Registro de todas las transacciones de pago ({total} registros)
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card compact>
        <div className="flex items-center gap-2 mb-2">
          <FunnelIcon className="w-4 h-4" />
          <span className="text-sm font-semibold">Filtros</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <select
            className="select select-bordered select-sm"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          >
            <option value="">Todos los meses</option>
            {monthNames.slice(1).map((name, i) => (
              <option key={i + 1} value={i + 1}>
                {name}
              </option>
            ))}
          </select>

          <select
            className="select select-bordered select-sm"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          >
            {[2024, 2025, 2026, 2027].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>

          <select
            className="select select-bordered select-sm"
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
          >
            <option value="">Todos los métodos</option>
            <option value="EFECTIVO">Efectivo</option>
            <option value="TRANSFERENCIA">Transferencia</option>
          </select>

          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setMonth('')
              setYear(now.getFullYear().toString())
              setMethodFilter('')
            }}
          >
            Limpiar
          </button>
        </div>
      </Card>

      {/* Transactions Table */}
      {transactions.length === 0 ? (
        <EmptyState
          title="Sin transacciones"
          description="No se encontraron pagos con los filtros seleccionados"
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="table table-sm w-full">
              <thead>
                <tr className="bg-base-200">
                  <th className="w-8"></th>
                  <th>Inquilino</th>
                  <th>Propiedad</th>
                  <th>Mes</th>
                  <th>Fecha Pago</th>
                  <th className="text-right">Monto</th>
                  <th>Método</th>
                  <th className="text-center">Punitorios</th>
                  <th className="text-center">Recibo</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const record = tx.monthlyRecord
                  const contract = record?.contract
                  const isExpanded = expandedId === tx.id

                  return (
                    <>
                      <tr
                        key={tx.id}
                        className="cursor-pointer hover:bg-base-200/50"
                        onClick={() =>
                          setExpandedId(isExpanded ? null : tx.id)
                        }
                      >
                        <td>
                          {isExpanded ? (
                            <ChevronUpIcon className="w-4 h-4" />
                          ) : (
                            <ChevronDownIcon className="w-4 h-4" />
                          )}
                        </td>
                        <td className="font-medium">
                          {contract?.tenant?.name || '-'}
                        </td>
                        <td>
                          {contract?.property?.address || '-'}
                          {contract?.property?.code && (
                            <span className="text-base-content/50 ml-1">
                              ({contract.property.code})
                            </span>
                          )}
                        </td>
                        <td>
                          {monthNames[record?.periodMonth] || ''}{' '}
                          {record?.periodYear} - Mes {record?.monthNumber}
                        </td>
                        <td>
                          {new Date(tx.paymentDate).toLocaleDateString('es-AR')}
                        </td>
                        <td className="text-right font-mono font-semibold">
                          {formatCurrency(tx.amount)}
                        </td>
                        <td>
                          <span
                            className={`badge badge-sm ${
                              tx.paymentMethod === 'EFECTIVO'
                                ? 'badge-success'
                                : 'badge-info'
                            }`}
                          >
                            {tx.paymentMethod === 'EFECTIVO'
                              ? 'Efectivo'
                              : 'Transferencia'}
                          </span>
                        </td>
                        <td className="text-center">
                          {tx.punitoryForgiven ? (
                            <span className="badge badge-xs badge-success">
                              Condonados
                            </span>
                          ) : tx.punitoryAmount > 0 ? (
                            <span className="text-error text-xs">
                              {formatCurrency(tx.punitoryAmount)}
                            </span>
                          ) : (
                            <span className="text-base-content/30">-</span>
                          )}
                        </td>
                        <td className="text-center">
                          {tx.receiptGenerated ? (
                            <span className="badge badge-xs badge-primary">
                              {tx.receiptNumber || 'SI'}
                            </span>
                          ) : (
                            <span className="text-base-content/30">-</span>
                          )}
                        </td>
                      </tr>

                      {/* Expanded Detail */}
                      {isExpanded && (
                        <tr key={`${tx.id}-detail`}>
                          <td colSpan="9" className="bg-base-200/30 p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Concepts Breakdown */}
                              <div>
                                <h4 className="font-semibold text-sm mb-2">
                                  Desglose de conceptos
                                </h4>
                                <div className="space-y-1">
                                  {tx.concepts?.map((c) => (
                                    <div
                                      key={c.id}
                                      className="flex justify-between text-sm"
                                    >
                                      <span>
                                        {c.type}
                                        {c.description && (
                                          <span className="text-base-content/50 ml-1 text-xs">
                                            ({c.description})
                                          </span>
                                        )}
                                      </span>
                                      <span className="font-mono">
                                        {formatCurrency(c.amount)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Additional Info */}
                              <div className="text-sm space-y-1">
                                <div>
                                  <span className="text-base-content/60">
                                    Recibo:{' '}
                                  </span>
                                  {tx.receiptNumber || 'No generado'}
                                </div>
                                {tx.observations && (
                                  <div>
                                    <span className="text-base-content/60">
                                      Observaciones:{' '}
                                    </span>
                                    {tx.observations}
                                  </div>
                                )}
                                <div>
                                  <span className="text-base-content/60">
                                    Registrado:{' '}
                                  </span>
                                  {new Date(tx.createdAt).toLocaleString(
                                    'es-AR'
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
