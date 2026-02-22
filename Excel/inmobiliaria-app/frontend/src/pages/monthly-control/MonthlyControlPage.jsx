// Monthly Control Page - Vista tipo planilla Excel
import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../stores/authStore'
import { useMonthlyRecords } from '../../hooks/useMonthlyRecords'
import { useMonthlyServices } from '../../hooks/useMonthlyServices'
import api from '../../services/api'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { LoadingPage } from '../../components/ui/Loading'
import EmptyState from '../../components/ui/EmptyState'
import PaymentRegistrationModal from '../../components/PaymentRegistrationModal'
import TransactionHistoryModal from '../../components/TransactionHistoryModal'
import DebtPaymentModal from '../../components/DebtPaymentModal'
import CloseMonthWizard from './CloseMonthWizard'
import { useDebts } from '../../hooks/useDebts'
import {
  TableCellsIcon,
  FunnelIcon,
  CurrencyDollarIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  WrenchScrewdriverIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  MagnifyingGlassPlusIcon,
  MagnifyingGlassMinusIcon,
  ArrowsPointingOutIcon,
  LockClosedIcon,
  NoSymbolIcon,
  BanknotesIcon,
  EyeIcon,
} from '@heroicons/react/24/outline'

const monthNames = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

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

const StatusBadge = ({ status }) => {
  const config = {
    COMPLETE: { class: 'badge-success', text: 'Pagado' },
    PARTIAL: { class: 'badge-warning', text: 'Parcial' },
    PENDING: { class: 'badge-error', text: 'Pendiente' },
  }
  const c = config[status] || config.PENDING
  return <span className={`badge badge-sm ${c.class}`}>{c.text}</span>
}

const BoolBadge = ({ value, yesText = 'SI', noText = 'NO' }) => (
  <span className={`badge badge-sm ${value ? 'badge-success' : 'badge-ghost'}`}>
    {value ? yesText : noText}
  </span>
)

export default function MonthlyControlPage() {
  const currentGroupId = useAuthStore((s) => s.currentGroupId)
  const now = new Date()

  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1)
  const [periodYear, setPeriodYear] = useState(now.getFullYear())
  const [statusFilter, setStatusFilter] = useState('')
  const [searchFilter, setSearchFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  // Table zoom/scale
  const [tableZoom, setTableZoom] = useState(100)

  // Expanded rows for service management
  const [expandedRows, setExpandedRows] = useState(new Set())

  // Modal states
  const [paymentModal, setPaymentModal] = useState({ open: false, record: null })
  const [debtModal, setDebtModal] = useState({ open: false, debt: null })
  const [txHistoryModal, setTxHistoryModal] = useState({ open: false, record: null })
  const [closeMonthWizard, setCloseMonthWizard] = useState(false)

  // Debt payment hook
  const { payDebt, isPaying } = useDebts(currentGroupId)

  // Send standard status to backend, handle HAS_DEBT locally
  const backendStatus = statusFilter === 'HAS_DEBT' ? '' : statusFilter
  const { records: allRecords, summary, isLoading } = useMonthlyRecords(
    currentGroupId,
    periodMonth,
    periodYear,
    { status: backendStatus, categoryId: categoryFilter }
  )

  // Apply local filters (search + debt) so results show instantly without API calls
  const records = useMemo(() => {
    let filtered = allRecords

    // Debt filter
    if (statusFilter === 'HAS_DEBT') {
      filtered = filtered.filter((r) => r.debtInfo && r.debtInfo.status !== 'PAID')
    }

    // Text search filter (client-side, instant)
    if (searchFilter.trim()) {
      const term = searchFilter.toLowerCase().trim()
      filtered = filtered.filter((r) => {
        const tenant = (r.tenants?.length > 0 ? r.tenants.map(t => t.name).join(' / ') : r.tenant?.name || '').toLowerCase()
        const address = (r.property?.address || '').toLowerCase()
        const owner = (r.owner?.name || '').toLowerCase()
        return tenant.includes(term) || address.includes(term) || owner.includes(term)
      })
    }

    return filtered
  }, [allRecords, statusFilter, searchFilter])

  // Navigation between months
  const goToPrevMonth = () => {
    if (periodMonth === 1) {
      setPeriodMonth(12)
      setPeriodYear(periodYear - 1)
    } else {
      setPeriodMonth(periodMonth - 1)
    }
  }

  const goToNextMonth = () => {
    if (periodMonth === 12) {
      setPeriodMonth(1)
      setPeriodYear(periodYear + 1)
    } else {
      setPeriodMonth(periodMonth + 1)
    }
  }

  // Services tooltip content
  const getServicesTooltip = (record) => {
    if (!record.services || record.services.length === 0) return 'Sin servicios'
    return record.services
      .map((s) => `${s.conceptType?.label || s.conceptType?.name}: ${formatCurrency(s.amount)}`)
      .join('\n')
  }

  // Toggle row expansion
  const toggleRow = (recordId) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(recordId)) {
        next.delete(recordId)
      } else {
        next.add(recordId)
      }
      return next
    })
  }

  // Zoom controls
  const zoomIn = () => setTableZoom((z) => Math.min(z + 10, 150))
  const zoomOut = () => setTableZoom((z) => Math.max(z - 10, 60))
  const resetZoom = () => setTableZoom(100)

  if (isLoading && allRecords.length === 0) return <LoadingPage />

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <TableCellsIcon className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Control Mensual</h1>
            <p className="text-sm text-base-content/60">
              Control de pagos por mes - todos los contratos activos
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Close Month button - visible when there are pending/partial records without debts */}
          {allRecords.some((r) => (r.status === 'PENDING' || r.status === 'PARTIAL') && !r.debtInfo) && (
            <button
              className="btn btn-sm btn-error gap-1"
              onClick={() => setCloseMonthWizard(true)}
              title="Cerrar mes y generar deudas"
            >
              <LockClosedIcon className="w-4 h-4" />
              Cerrar Mes
            </button>
          )}

          <div className="divider divider-horizontal mx-0"></div>
          <span className="text-sm text-base-content/60 mr-2">Zoom: {tableZoom}%</span>
          <button
            className="btn btn-sm btn-ghost"
            onClick={zoomOut}
            disabled={tableZoom <= 60}
            title="Alejar (-)">
            <MagnifyingGlassMinusIcon className="w-4 h-4" />
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={resetZoom}
            title="Restablecer (100%)">
            <ArrowsPointingOutIcon className="w-4 h-4" />
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={zoomIn}
            disabled={tableZoom >= 150}
            title="Acercar (+)">
            <MagnifyingGlassPlusIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Month Selector + Summary Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Month Navigation */}
        <Card compact>
          <div className="flex items-center justify-between">
            <button className="btn btn-ghost btn-sm" onClick={goToPrevMonth}>
              <ChevronLeftIcon className="w-4 h-4" />
            </button>
            <div className="text-center">
              <div className="text-lg font-bold">
                {monthNames[periodMonth]} {periodYear}
              </div>
              <div className="text-xs text-base-content/60">
                {summary.total || 0} contratos
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={goToNextMonth}>
              <ChevronRightIcon className="w-4 h-4" />
            </button>
          </div>
        </Card>

        {/* Summary Cards */}
        <Card compact>
          <div className="flex items-center gap-2">
            <CheckCircleIcon className="w-5 h-5 text-success" />
            <div>
              <div className="text-xs text-base-content/60">Pagados</div>
              <div className="text-lg font-bold text-success">
                {summary.paid || 0} / {summary.total || 0}
              </div>
            </div>
          </div>
        </Card>

        <Card compact>
          <div className="flex items-center gap-2">
            <CurrencyDollarIcon className="w-5 h-5 text-info" />
            <div>
              <div className="text-xs text-base-content/60">Total Adeudado</div>
              <div className="text-lg font-bold">
                {formatCurrency(summary.totalDue)}
              </div>
            </div>
          </div>
        </Card>

        <Card compact>
          <div className="flex items-center gap-2">
            <CurrencyDollarIcon className="w-5 h-5 text-success" />
            <div>
              <div className="text-xs text-base-content/60">Total Cobrado</div>
              <div className="text-lg font-bold text-success">
                {formatCurrency(summary.totalPaid)}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Debt Summary Cards - only when there are debts */}
      {summary.openDebts > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card compact>
            <div className="flex items-center gap-2">
              <ExclamationTriangleIcon className="w-5 h-5 text-error" />
              <div>
                <div className="text-xs text-base-content/60">Deudas Abiertas</div>
                <div className="text-lg font-bold text-error">{summary.openDebts}</div>
              </div>
            </div>
          </Card>
          <Card compact>
            <div className="flex items-center gap-2">
              <BanknotesIcon className="w-5 h-5 text-error" />
              <div>
                <div className="text-xs text-base-content/60">Total Deuda (con punitorios)</div>
                <div className="text-lg font-bold text-error">{formatCurrency(summary.totalDebtAmount)}</div>
              </div>
            </div>
          </Card>
          <Card compact>
            <div className="flex items-center gap-2">
              <NoSymbolIcon className="w-5 h-5 text-error" />
              <div>
                <div className="text-xs text-base-content/60">Contratos Bloqueados</div>
                <div className="text-lg font-bold">{summary.blockedContracts}</div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card compact>
        <div className="flex items-center gap-2 mb-2">
          <FunnelIcon className="w-4 h-4" />
          <span className="text-sm font-semibold">Filtros</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <select
            className="select select-bordered select-sm w-full"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Todos los estados</option>
            <option value="COMPLETE">Pagado</option>
            <option value="PARTIAL">Parcial</option>
            <option value="PENDING">Pendiente</option>
            <option value="HAS_DEBT">Con deuda</option>
          </select>

          <select
            className="select select-bordered select-sm w-full"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">Todas las categorías</option>
          </select>

          <input
            type="text"
            placeholder="Buscar inquilino, propiedad..."
            className="input input-bordered input-sm w-full"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />

          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setStatusFilter('')
              setCategoryFilter('')
              setSearchFilter('')
            }}
          >
            Limpiar
          </button>
        </div>
      </Card>

      {/* Main Table */}
      {records.length === 0 ? (
        <EmptyState
          title="Sin registros"
          description={`No hay contratos activos para ${monthNames[periodMonth]} ${periodYear}`}
        />
      ) : (
        <Card className="flex-1 flex flex-col overflow-hidden">
          <div className="overflow-auto flex-1">
            <div
              style={{
                transform: `scale(${tableZoom / 100})`,
                transformOrigin: 'top left',
                minWidth: '1800px'
              }}
            >
              <table className="table table-xs" style={{ minWidth: '1800px' }}>
              <thead>
                <tr className="bg-base-200">
                  <th className="text-xs w-8"></th>
                  <th className="text-xs">Propiedad</th>
                  <th className="text-xs">Dueño</th>
                  <th className="text-xs">Inquilino</th>
                  <th className="text-xs">Mes</th>
                  <th className="text-xs">Próx. Ajuste</th>
                  <th className="text-xs text-right">Alquiler</th>
                  <th className="text-xs text-right">Servicios</th>
                  <th className="text-xs text-right">A Favor Ant.</th>
                  <th className="text-xs text-right">Punitorios</th>
                  <th className="text-xs text-right font-bold">TOTAL</th>
                  <th className="text-xs">Fecha Pago</th>
                  <th className="text-xs text-right">Abonado</th>
                  <th className="text-xs text-right">A Favor Sig.</th>
                  <th className="text-xs text-right">Debe Sig.</th>
                  <th className="text-xs text-center">Canceló</th>
                  <th className="text-xs text-center">Pagó</th>
                  <th className="text-xs text-center">Deuda</th>
                  <th className="text-xs text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record, idx) => {
                  const rowClass = record.status === 'COMPLETE'
                    ? 'bg-success/10'
                    : record.status === 'PARTIAL'
                    ? 'bg-warning/10'
                    : idx % 2 === 1
                    ? 'bg-base-200/50'
                    : ''
                  const isExpanded = expandedRows.has(record.id)

                  return (
                    <>
                      <tr key={record.id} className={rowClass}>
                        <td className="text-center">
                          <button
                            className="btn btn-xs btn-ghost"
                            onClick={() => toggleRow(record.id)}
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
                          {record.tenants?.length > 0
                            ? record.tenants.map(t => t.name).join(' / ')
                            : record.tenant?.name || 'Sin inquilino'}
                        </td>
                        <td className="text-xs whitespace-nowrap">
                          {record.periodLabel}
                        </td>
                        <td className="text-xs">
                          {record.nextAdjustmentLabel || '-'}
                        </td>
                        <td className="text-xs text-right font-mono">
                          {formatCurrency(record.rentAmount)}
                        </td>
                        <td
                          className="text-xs text-right font-mono cursor-pointer hover:bg-base-200"
                          title={getServicesTooltip(record)}
                          onClick={() => toggleRow(record.id)}
                        >
                          <span className="underline decoration-dotted">
                            {formatCurrency(record.servicesTotal)}
                          </span>
                        </td>
                        <td className="text-xs text-right font-mono text-info">
                          {record.previousBalance > 0
                            ? formatCurrency(record.previousBalance)
                            : '-'}
                        </td>
                        <td className="text-xs text-right font-mono text-error">
                          {record.punitoryForgiven
                            ? <span className="text-success text-[10px]">Cond.</span>
                            : (record.totalPunitoriosHistoricos || record.livePunitoryAmount) > 0
                            ? <div className="flex flex-col items-end">
                                <span>{formatCurrency(record.totalPunitoriosHistoricos || record.livePunitoryAmount)}</span>
                                <span className="text-[9px] text-error/70">{record.livePunitoryDays}d</span>
                              </div>
                            : record.punitoryAmount > 0
                            ? formatCurrency(record.punitoryAmount)
                            : '-'}
                        </td>
                        <td className="text-xs text-right font-mono font-bold">
                          {formatCurrency(record.totalHistorico || record.liveTotalDue || record.totalDue)}
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
                        </td>
                        <td className="text-xs text-right font-mono text-success">
                          {record.aFavorNextMonth > 0
                            ? formatCurrency(record.aFavorNextMonth)
                            : '-'}
                        </td>
                        <td className="text-xs text-right font-mono text-error">
                          {record.debeNextMonth > 0
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
                          {record.debtInfo && record.debtInfo.status !== 'PAID' ? (
                            <button
                              className="btn btn-xs btn-error"
                              onClick={() => setDebtModal({ open: true, debt: record.debtInfo })}
                              title="Pagar deuda"
                            >
                              <BanknotesIcon className="w-3 h-3" />
                            </button>
                          ) : record.status === 'COMPLETE' ? (
                            <CheckCircleIcon className="w-4 h-4 text-success" />
                          ) : (
                            <button
                              className="btn btn-xs btn-primary"
                              onClick={() => setPaymentModal({ open: true, record })}
                              disabled={record.status === 'COMPLETE'}
                              title="Registrar pago"
                            >
                              <CurrencyDollarIcon className="w-3 h-3" />
                            </button>
                          )}
                          {/* Transaction history / void button */}
                          {record.amountPaid > 0 && (
                            <button
                              className="btn btn-xs btn-ghost"
                              onClick={() => setTxHistoryModal({ open: true, record })}
                              title="Ver pagos / Anular"
                            >
                              <EyeIcon className="w-3 h-3" />
                            </button>
                          )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded row - Service management inline */}
                      {isExpanded && (
                        <tr key={`${record.id}-expanded`} className="bg-base-200/50">
                          <td colSpan="19" className="p-0">
                            <ServiceManagerInline record={record} groupId={currentGroupId} />
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>

          {/* Table Footer Summary */}
          <div className="flex-shrink-0 flex justify-between items-center mt-4 pt-4 border-t border-base-200 text-sm">
            <div className="flex gap-4">
              <span>
                <CheckCircleIcon className="w-4 h-4 inline text-success mr-1" />
                {summary.paid} pagados
              </span>
              <span>
                <ExclamationTriangleIcon className="w-4 h-4 inline text-warning mr-1" />
                {summary.partial} parciales
              </span>
              <span>
                <ClockIcon className="w-4 h-4 inline text-error mr-1" />
                {summary.pending} pendientes
              </span>
            </div>
            <div className="flex gap-4 font-mono">
              <span>Adeudado: <strong>{formatCurrency(summary.totalDue)}</strong></span>
              <span className="text-success">
                Cobrado: <strong>{formatCurrency(summary.totalPaid)}</strong>
              </span>
            </div>
          </div>
        </Card>
      )}

      {/* Payment Registration Modal */}
      {paymentModal.open && (
        <PaymentRegistrationModal
          record={paymentModal.record}
          groupId={currentGroupId}
          onClose={() => setPaymentModal({ open: false, record: null })}
        />
      )}

      {/* Transaction History Modal */}
      {txHistoryModal.open && (
        <TransactionHistoryModal
          record={txHistoryModal.record}
          groupId={currentGroupId}
          onClose={() => setTxHistoryModal({ open: false, record: null })}
        />
      )}

      {/* Debt Payment Modal */}
      {debtModal.open && (
        <DebtPaymentModal
          debt={debtModal.debt}
          groupId={currentGroupId}
          onPay={payDebt}
          isPaying={isPaying}
          onClose={() => setDebtModal({ open: false, debt: null })}
        />
      )}

      {/* Close Month Wizard */}
      {closeMonthWizard && (
        <CloseMonthWizard
          groupId={currentGroupId}
          month={periodMonth}
          year={periodYear}
          onClose={() => setCloseMonthWizard(false)}
          onSuccess={() => {}}
        />
      )}
    </div>
  )
}

// Inline Service Manager Component
function ServiceManagerInline({ record, groupId }) {
  const { services, addService, updateService, removeService } = useMonthlyServices(groupId, record.id)
  const [selectedConceptId, setSelectedConceptId] = useState('')
  const [newAmount, setNewAmount] = useState('')

  // Fetch available concept types using TanStack Query
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
    addService({
      conceptTypeId: selectedConceptId,
      amount: parseFloat(newAmount)
    })
    setSelectedConceptId('')
    setNewAmount('')
  }

  const handleUpdateService = (serviceId, newAmount) => {
    updateService({ serviceId, amount: parseFloat(newAmount) })
  }

  const handleRemoveService = (serviceId) => {
    if (!confirm('¿Eliminar este servicio?')) return
    removeService(serviceId)
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

      {/* Current services */}
      {services && services.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {services.map((service) => (
            <div key={service.id} className="flex items-center gap-2 bg-base-100 p-2 rounded border border-base-300">
              <span className={`badge badge-sm ${getCategoryColor(service.conceptType?.category)}`}>
                {service.conceptType?.name}
              </span>
              <input
                type="number"
                className="input input-xs input-bordered w-24"
                defaultValue={service.amount}
                onBlur={(e) => {
                  const val = parseFloat(e.target.value)
                  if (val !== service.amount && val > 0) {
                    handleUpdateService(service.id, val)
                  }
                }}
              />
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

      {/* Add new service */}
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
      </div>
    </div>
  )
}
