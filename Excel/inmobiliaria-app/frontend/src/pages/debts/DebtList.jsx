// Debt List Page - Tabla de deudas con punitorios acumulados
import { useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useDebts } from '../../hooks/useDebts'
import Card from '../../components/ui/Card'
import { LoadingPage } from '../../components/ui/Loading'
import EmptyState from '../../components/ui/EmptyState'
import DebtPaymentModal from '../../components/DebtPaymentModal'
import {
  ExclamationTriangleIcon,
  CurrencyDollarIcon,
  ClockIcon,
  CheckCircleIcon,
  FunnelIcon,
  NoSymbolIcon,
} from '@heroicons/react/24/outline'

const formatCurrency = (amount) => {
  if (!amount && amount !== 0) return '$0'
  return `$${Math.round(amount).toLocaleString('es-AR')}`
}

const StatusBadge = ({ status }) => {
  const config = {
    OPEN: { class: 'badge-error', text: 'Abierta' },
    PARTIAL: { class: 'badge-warning', text: 'Parcial' },
    PAID: { class: 'badge-success', text: 'Pagada' },
  }
  const c = config[status] || config.OPEN
  return <span className={`badge badge-sm ${c.class}`}>{c.text}</span>
}

export default function DebtList() {
  const currentGroupId = useAuthStore((s) => s.currentGroupId)

  const [statusFilter, setStatusFilter] = useState('')
  const [paymentModal, setPaymentModal] = useState({ open: false, debt: null })

  const { debts, isLoading, summary, payDebt, isPaying } = useDebts(currentGroupId, {
    status: statusFilter || undefined,
  })

  if (isLoading) return <LoadingPage />

  const openDebts = debts.filter((d) => d.status !== 'PAID')
  const blockedContracts = [...new Set(openDebts.map((d) => d.contractId))]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <ExclamationTriangleIcon className="w-7 h-7 text-error" />
          <div>
            <h1 className="text-2xl font-bold">Deudas</h1>
            <p className="text-sm text-base-content/60">
              Deudas pendientes con punitorios acumulados
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card compact>
          <div className="flex items-center gap-2">
            <ExclamationTriangleIcon className="w-5 h-5 text-error" />
            <div>
              <div className="text-xs text-base-content/60">Deudas Abiertas</div>
              <div className="text-lg font-bold text-error">{summary.openDebtsCount || 0}</div>
            </div>
          </div>
        </Card>

        <Card compact>
          <div className="flex items-center gap-2">
            <CurrencyDollarIcon className="w-5 h-5 text-error" />
            <div>
              <div className="text-xs text-base-content/60">Total Deuda</div>
              <div className="text-lg font-bold text-error">{formatCurrency(summary.totalDebt)}</div>
            </div>
          </div>
        </Card>

        <Card compact>
          <div className="flex items-center gap-2">
            <ClockIcon className="w-5 h-5 text-warning" />
            <div>
              <div className="text-xs text-base-content/60">Total Punitorios</div>
              <div className="text-lg font-bold text-warning">{formatCurrency(summary.totalPunitory)}</div>
            </div>
          </div>
        </Card>

        <Card compact>
          <div className="flex items-center gap-2">
            <NoSymbolIcon className="w-5 h-5 text-error" />
            <div>
              <div className="text-xs text-base-content/60">Contratos Bloqueados</div>
              <div className="text-lg font-bold">{summary.blockedContracts || 0}</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Blocked tenants alert */}
      {blockedContracts.length > 0 && (
        <div className="alert alert-error">
          <NoSymbolIcon className="w-5 h-5" />
          <div>
            <span className="font-bold">
              {blockedContracts.length} contrato(s) bloqueado(s)
            </span>
            <span className="text-sm ml-2">
              No pueden registrar pagos del mes actual hasta pagar deudas pendientes
            </span>
          </div>
        </div>
      )}

      {/* Filter */}
      <Card compact>
        <div className="flex items-center gap-2">
          <FunnelIcon className="w-4 h-4" />
          <span className="text-sm font-semibold">Filtro</span>
          <select
            className="select select-bordered select-sm ml-2"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Todas</option>
            <option value="OPEN">Abiertas</option>
            <option value="PARTIAL">Parciales</option>
            <option value="PAID">Pagadas</option>
          </select>
        </div>
      </Card>

      {/* Table */}
      {debts.length === 0 ? (
        <EmptyState
          title="Sin deudas"
          description="No hay deudas registradas"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table table-sm table-zebra">
              <thead>
                <tr className="bg-base-200">
                  <th className="text-xs">Periodo</th>
                  <th className="text-xs">Inquilino</th>
                  <th className="text-xs">Propiedad</th>
                  <th className="text-xs text-right">Deuda Base</th>
                  <th className="text-xs text-right">Punitorios</th>
                  <th className="text-xs text-right">Pagado</th>
                  <th className="text-xs text-right font-bold">Total Actual</th>
                  <th className="text-xs text-center">Estado</th>
                  <th className="text-xs text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {debts.map((debt) => (
                  <tr
                    key={debt.id}
                    className={
                      debt.status === 'PAID'
                        ? 'bg-success/5'
                        : debt.status === 'PARTIAL'
                        ? 'bg-warning/5'
                        : ''
                    }
                  >
                    <td className="text-xs font-medium whitespace-nowrap">
                      {debt.periodLabel}
                    </td>
                    <td className="text-xs font-medium">
                      {debt.contract?.tenant?.name}
                    </td>
                    <td className="text-xs">
                      {debt.contract?.property?.address}
                    </td>
                    <td className="text-xs text-right font-mono">
                      {formatCurrency(debt.unpaidRentAmount)}
                    </td>
                    <td className="text-xs text-right font-mono text-error">
                      {debt.status !== 'PAID'
                        ? formatCurrency(debt.liveAccumulatedPunitory)
                        : formatCurrency(debt.accumulatedPunitory)}
                      {debt.livePunitoryDays > 0 && debt.status !== 'PAID' && (
                        <div className="text-[10px] text-base-content/50">
                          {debt.livePunitoryDays}d
                        </div>
                      )}
                    </td>
                    <td className="text-xs text-right font-mono text-success">
                      {debt.amountPaid > 0 ? formatCurrency(debt.amountPaid) : '-'}
                    </td>
                    <td className="text-xs text-right font-mono font-bold text-error">
                      {debt.status !== 'PAID'
                        ? formatCurrency(debt.liveCurrentTotal)
                        : <span className="text-success">$0</span>}
                    </td>
                    <td className="text-center">
                      <StatusBadge status={debt.status} />
                    </td>
                    <td className="text-center">
                      {debt.status !== 'PAID' && (
                        <button
                          className="btn btn-xs btn-primary"
                          onClick={() => setPaymentModal({ open: true, debt })}
                          title="Pagar deuda"
                        >
                          <CurrencyDollarIcon className="w-3 h-3" />
                        </button>
                      )}
                      {debt.status === 'PAID' && (
                        <CheckCircleIcon className="w-4 h-4 text-success inline" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer Summary */}
          <div className="flex justify-between items-center mt-4 pt-4 border-t border-base-200 text-sm px-4 pb-2">
            <div className="flex gap-4">
              <span>
                <ExclamationTriangleIcon className="w-4 h-4 inline text-error mr-1" />
                {debts.filter((d) => d.status === 'OPEN').length} abiertas
              </span>
              <span>
                <ClockIcon className="w-4 h-4 inline text-warning mr-1" />
                {debts.filter((d) => d.status === 'PARTIAL').length} parciales
              </span>
              <span>
                <CheckCircleIcon className="w-4 h-4 inline text-success mr-1" />
                {debts.filter((d) => d.status === 'PAID').length} pagadas
              </span>
            </div>
          </div>
        </Card>
      )}

      {/* Payment Modal */}
      {paymentModal.open && (
        <DebtPaymentModal
          debt={paymentModal.debt}
          groupId={currentGroupId}
          onPay={payDebt}
          isPaying={isPaying}
          onClose={() => setPaymentModal({ open: false, debt: null })}
        />
      )}
    </div>
  )
}
