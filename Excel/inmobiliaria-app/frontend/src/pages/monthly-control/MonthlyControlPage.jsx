// Monthly Control Page - Vista tipo planilla Excel
import { useState, useMemo, useEffect, memo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../stores/authStore'
import { useMonthlyRecords } from '../../hooks/useMonthlyRecords'
import { useMonthlyServices } from '../../hooks/useMonthlyServices'
import { useCategories } from '../../hooks/useCategories'
import api from '../../services/api'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { LoadingPage } from '../../components/ui/Loading'
import EmptyState from '../../components/ui/EmptyState'
import PaymentRegistrationModal from '../../components/PaymentRegistrationModal'
import TransactionHistoryModal from '../../components/TransactionHistoryModal'
import DebtPaymentModal from '../../components/DebtPaymentModal'
import CloseMonthWizard from './CloseMonthWizard'
import BatchServiceModal from './BatchServiceModal'
import BulkLoadServiceModal from './BulkLoadServiceModal'
import { useDebts } from '../../hooks/useDebts'
import { useNotifications } from '../../hooks/useNotifications'
import SendNotificationModal from '../../components/notifications/SendNotificationModal'
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
  BellIcon,
  CalendarDaysIcon,
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

// Sortable column header component
const SortableHeader = ({ label, column, sortColumn, sortDirection, onSort, align, bold }) => {
  const isActive = sortColumn === column
  return (
    <th
      className={`text-xs cursor-pointer select-none hover:bg-base-300 transition-colors ${align === 'right' ? 'text-right' : ''} ${bold ? 'font-bold' : ''}`}
      onClick={() => onSort(column)}
      title={`Ordenar por ${label}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          sortDirection === 'asc'
            ? <ChevronUpIcon className="w-3 h-3 text-primary" />
            : <ChevronDownIcon className="w-3 h-3 text-primary" />
        ) : (
          <span className="w-3 h-3 inline-block opacity-0 group-hover:opacity-30">↕</span>
        )}
      </span>
    </th>
  )
}

export default function MonthlyControlPage() {
  const currentGroupId = useAuthStore((s) => s.currentGroupId)
  const now = new Date()
  const [searchParams] = useSearchParams()

  const [periodMonth, setPeriodMonth] = useState(() => {
    const m = parseInt(searchParams.get('month'))
    return (m >= 1 && m <= 12) ? m : now.getMonth() + 1
  })
  const [periodYear, setPeriodYear] = useState(() => {
    const y = parseInt(searchParams.get('year'))
    return (y >= 2020 && y <= 2100) ? y : now.getFullYear()
  })
  const [statusFilter, setStatusFilter] = useState('')
  const [searchFilter, setSearchFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [contractTypeFilter, setContractTypeFilter] = useState('')

  // Sort state
  const [sortColumn, setSortColumn] = useState(null) // null | 'propiedad' | 'dueno' | 'inquilino' | 'mes' | 'alquiler' | 'total' | 'pagado'
  const [sortDirection, setSortDirection] = useState('asc') // 'asc' | 'desc'

  // Table zoom/scale
  const [tableZoom, setTableZoom] = useState(100)

  // Expanded rows for service management
  const [expandedRows, setExpandedRows] = useState(new Set())

  // Modal states
  const [paymentModal, setPaymentModal] = useState({ open: false, record: null })
  const [debtModal, setDebtModal] = useState({ open: false, debt: null })
  const [txHistoryModal, setTxHistoryModal] = useState({ open: false, record: null })
  const [closeMonthWizard, setCloseMonthWizard] = useState(false)
  const [showBatchService, setShowBatchService] = useState(false)
  const [showBulkLoad, setShowBulkLoad] = useState(false)

  // Debt payment hook
  const { payDebt, isPaying, forgiveDebt } = useDebts(currentGroupId)

  // Categories for filter
  const { categories } = useCategories(currentGroupId)

  // Notification state
  const [notifyModal, setNotifyModal] = useState({ open: false, record: null })
  const { sendNextMonth } = useNotifications(currentGroupId)

  // Send standard status to backend, handle HAS_DEBT locally
  const backendStatus = statusFilter === 'HAS_DEBT' ? '' : statusFilter
  const { records: allRecords, summary, isLoading, toggleIva, forgiveBalance, toggleComprobante } = useMonthlyRecords(
    currentGroupId,
    periodMonth,
    periodYear,
    { status: backendStatus, categoryId: categoryFilter }
  )

  // Apply local filters (search + debt + contractType) so results show instantly without API calls
  const records = useMemo(() => {
    let filtered = allRecords

    // Debt filter
    if (statusFilter === 'HAS_DEBT') {
      filtered = filtered.filter((r) => r.debtInfo && r.debtInfo.status !== 'PAID')
    }

    // Contract type filter
    if (contractTypeFilter) {
      filtered = filtered.filter((r) => (r.contractType || 'INQUILINO') === contractTypeFilter)
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

    // Apply sorting
    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        let valA, valB
        switch (sortColumn) {
          case 'propiedad':
            valA = (a.property?.address || '').toLowerCase()
            valB = (b.property?.address || '').toLowerCase()
            return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)
          case 'dueno':
            valA = (a.owner?.name || '').toLowerCase()
            valB = (b.owner?.name || '').toLowerCase()
            return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)
          case 'inquilino': {
            const tenantA = a.tenants?.length > 0 ? a.tenants.map(t => t.name).join(' / ') : a.tenant?.name || ''
            const tenantB = b.tenants?.length > 0 ? b.tenants.map(t => t.name).join(' / ') : b.tenant?.name || ''
            valA = tenantA.toLowerCase()
            valB = tenantB.toLowerCase()
            return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)
          }
          case 'mes':
            valA = a.monthNumber || 0
            valB = b.monthNumber || 0
            return sortDirection === 'asc' ? valA - valB : valB - valA
          case 'alquiler':
            valA = a.rentAmount || 0
            valB = b.rentAmount || 0
            return sortDirection === 'asc' ? valA - valB : valB - valA
          case 'total':
            valA = a.totalHistorico || a.liveTotalDue || a.totalDue || 0
            valB = b.totalHistorico || b.liveTotalDue || b.totalDue || 0
            return sortDirection === 'asc' ? valA - valB : valB - valA
          case 'pagado':
            valA = a.amountPaid || 0
            valB = b.amountPaid || 0
            return sortDirection === 'asc' ? valA - valB : valB - valA
          default:
            return 0
        }
      })
    }

    return filtered
  }, [allRecords, statusFilter, searchFilter, contractTypeFilter, sortColumn, sortDirection])

  // Detect if IVA column should be shown
  const showIvaColumn = useMemo(() => {
    return allRecords.some(
      (r) => r.ivaAmount > 0 || r.includeIva || r.contract?.pagaIva || ['LOCAL COMERCIAL', 'LOCAL'].includes(r.property?.category?.name)
    )
  }, [allRecords])

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
  const toggleRow = useCallback((recordId) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(recordId)) {
        next.delete(recordId)
      } else {
        next.add(recordId)
      }
      return next
    })
  }, [])

  // Stable callbacks for row actions
  const handlePayment = useCallback((record) => {
    setPaymentModal({ open: true, record })
  }, [])

  const handleDebtPayment = useCallback((debt) => {
    setDebtModal({ open: true, debt })
  }, [])

  const handleTxHistory = useCallback((record) => {
    setTxHistoryModal({ open: true, record })
  }, [])

  const handleNotify = useCallback((record) => {
    setNotifyModal({ open: true, record })
  }, [])

  // Sort handler
  const handleSort = useCallback((column) => {
    setSortColumn((prev) => {
      if (prev === column) {
        // Toggle direction, then clear on third click
        setSortDirection((d) => {
          if (d === 'asc') return 'desc'
          // Reset sort
          setSortColumn(null)
          return 'asc'
        })
        return column
      }
      setSortDirection('asc')
      return column
    })
  }, [])

  // Zoom controls
  const zoomIn = () => setTableZoom((z) => Math.min(z + 10, 150))
  const zoomOut = () => setTableZoom((z) => Math.max(z - 10, 60))
  const resetZoom = () => setTableZoom(100)

  if (isLoading && allRecords.length === 0) return <LoadingPage />

  return (
    <div className="space-y-4">
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
          <button
              className="btn btn-sm btn-primary gap-1"
              onClick={() => setShowBatchService(true)}
              title="Cargar servicio a múltiples propiedades (distribuir)"
            >
              <WrenchScrewdriverIcon className="w-4 h-4" />
              Cargar Servicio
            </button>
            <button
              className="btn btn-sm btn-secondary gap-1"
              onClick={() => setShowBulkLoad(true)}
              title="Cargar mismo servicio a múltiples propiedades y meses"
            >
              <CalendarDaysIcon className="w-4 h-4" />
              Carga Masiva
            </button>
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
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
            value={contractTypeFilter}
            onChange={(e) => setContractTypeFilter(e.target.value)}
          >
            <option value="">Todos los tipos</option>
            <option value="INQUILINO">Inquilinos</option>
            <option value="PROPIETARIO">Propietarios</option>
          </select>

          <select
            className="select select-bordered select-sm w-full"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">Todas las categorías</option>
            {(categories || []).map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
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
              setContractTypeFilter('')
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
        <Card>
          <div className="overflow-x-auto">
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
                  <SortableHeader label="Propiedad" column="propiedad" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                  <SortableHeader label="Dueño" column="dueno" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                  <SortableHeader label="Inquilino" column="inquilino" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                  <SortableHeader label="Mes" column="mes" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                  <th className="text-xs">Próx. Ajuste</th>
                  <SortableHeader label="Alquiler" column="alquiler" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" />
                  <th className="text-xs text-right">Servicios</th>
                  <th className="text-xs text-center w-28">Comprobantes</th>
                  {showIvaColumn && <th className="text-xs text-right">IVA (21%)</th>}
                  <th className="text-xs text-right">A Favor Ant.</th>
                  <th className="text-xs text-right">Punitorios</th>
                  <SortableHeader label="TOTAL" column="total" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" bold />
                  <th className="text-xs">Fecha Pago</th>
                  <SortableHeader label="Abonado" column="pagado" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" />
                  <th className="text-xs text-right">A Favor Sig.</th>
                  <th className="text-xs text-right">Debe Sig.</th>
                  <th className="text-xs text-center">Canceló</th>
                  <th className="text-xs text-center">Pagó</th>
                  <th className="text-xs text-center">Deuda</th>
                  <th className="text-xs text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record, idx) => (
                  <MonthlyRecordRow
                    key={record.id}
                    record={record}
                    idx={idx}
                    isExpanded={expandedRows.has(record.id)}
                    showIvaColumn={showIvaColumn}
                    groupId={currentGroupId}
                    onToggleRow={toggleRow}
                    onToggleIva={toggleIva}
                    onPayment={handlePayment}
                    onDebtPayment={handleDebtPayment}
                    onTxHistory={handleTxHistory}
                    onForgiveBalance={forgiveBalance}
                    onForgiveDebt={forgiveDebt}
                    onToggleComprobante={toggleComprobante}
                    onNotify={handleNotify}
                  />
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {/* Table Footer Summary */}
          <div className="flex justify-between items-center mt-4 pt-4 border-t border-base-200 text-sm">
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
      {showBatchService && (
        <BatchServiceModal
          groupId={currentGroupId}
          records={allRecords}
          periodMonth={periodMonth}
          periodYear={periodYear}
          onClose={() => setShowBatchService(false)}
        />
      )}
      {showBulkLoad && (
        <BulkLoadServiceModal
          groupId={currentGroupId}
          records={allRecords}
          periodMonth={periodMonth}
          periodYear={periodYear}
          onClose={() => setShowBulkLoad(false)}
        />
      )}
      {closeMonthWizard && (
        <CloseMonthWizard
          groupId={currentGroupId}
          month={periodMonth}
          year={periodYear}
          onClose={() => setCloseMonthWizard(false)}
          onSuccess={() => {}}
        />
      )}

      {/* Send Notification Modal */}
      {notifyModal.open && notifyModal.record && (
        <SendNotificationModal
          isOpen={notifyModal.open}
          onClose={() => setNotifyModal({ open: false, record: null })}
          type="NEXT_MONTH"
          recipients={[notifyModal.record.tenants?.[0] || notifyModal.record.tenant].filter(Boolean)}
          recipientType="TENANT"
          onSend={async ({ channels }) => {
            const tenant = notifyModal.record.tenants?.[0] || notifyModal.record.tenant
            await sendNextMonth.mutateAsync({
              tenantIds: [tenant.id],
              channels,
              periodMonth,
              periodYear,
            })
            setNotifyModal({ open: false, record: null })
          }}
          isSending={sendNextMonth.isPending}
        />
      )}
    </div>
  )
}

// Memoized table row to prevent re-renders when unrelated state changes
const MonthlyRecordRow = memo(function MonthlyRecordRow({
  record, idx, isExpanded, showIvaColumn, groupId,
  onToggleRow, onToggleIva, onPayment, onDebtPayment, onTxHistory, onForgiveBalance, onForgiveDebt, onToggleComprobante, onNotify,
}) {
  const isPropietario = (record.contractType || 'INQUILINO') === 'PROPIETARIO'

  const isPenalty = !!record.isPenaltyRecord

  const rowClass = isPenalty
    ? 'bg-warning/15 border-l-4 border-warning'
    : record.status === 'COMPLETE'
    ? 'bg-success/25'
    : record.debtInfo && record.debtInfo.status !== 'PAID'
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
          {record.debtInfo && record.debtInfo.status !== 'PAID' ? (
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
          {record.amountPaid > 0 && (
            <button
              className="btn btn-xs btn-ghost"
              onClick={() => onTxHistory(record)}
              title="Ver pagos / Anular"
            >
              <EyeIcon className="w-3 h-3" />
            </button>
          )}
          {record.balanceForgiven > 0 ? (
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
          ) : record.status === 'PARTIAL' && !record.debtInfo && record.balance < 0 ? (
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
          {!isPropietario && (
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

// Inline Service Manager Component
function ServiceManagerInline({ record, groupId }) {
  const { services, addService, updateService, removeService } = useMonthlyServices(groupId, record.id)
  const [selectedConceptId, setSelectedConceptId] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [propagateForward, setPropagateForward] = useState(true)

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
      amount: parseFloat(newAmount),
      propagateForward,
    })
    setSelectedConceptId('')
    setNewAmount('')
  }

  const handleUpdateService = (serviceId, newAmount) => {
    updateService({ serviceId, amount: parseFloat(newAmount), propagateForward })
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
