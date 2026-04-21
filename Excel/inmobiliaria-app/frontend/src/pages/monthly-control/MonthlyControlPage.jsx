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
import { MonthlyRecordRow } from './MonthlyRecordRow'
import { useMonthlyFiltering } from '../../hooks/useMonthlyFiltering'
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
  const { records: allRecords, summary, isLoading, refetch: refetchRecords, toggleIva, forgiveBalance, toggleComprobante } = useMonthlyRecords(
    currentGroupId,
    periodMonth,
    periodYear,
    { status: backendStatus, categoryId: categoryFilter }
  )

  // Wrappers that refetch records after debt actions so the summary updates immediately
  const handlePayDebt = useCallback(async (data) => {
    await payDebt(data)
    refetchRecords()
  }, [payDebt, refetchRecords])

  const handleForgiveDebt = useCallback(async (data) => {
    await forgiveDebt(data)
    refetchRecords()
  }, [forgiveDebt, refetchRecords])

  const filtersState = { statusFilter, searchFilter, categoryFilter, contractTypeFilter, sortColumn, sortDirection };
  const { filteredRecords: records, showIvaColumn } = useMonthlyFiltering(allRecords, filtersState);

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

      {/* Dirty records syncing banner */}
      {allRecords.some(r => r.needsRecalculation) && (
        <div className="alert alert-info shadow-sm py-2 px-4 rounded-xl flex">
          <span className="loading loading-spinner w-4 h-4 shrink-0 text-info-content opacity-70"></span>
          <span className="text-sm">
            <strong>Sincronizando:</strong> Se están recalculando saldos en segundo plano. Los montos podrían actualizarse brevemente...
          </span>
        </div>
      )}

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
                    onForgiveDebt={handleForgiveDebt}
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
          onPay={handlePayDebt}
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
