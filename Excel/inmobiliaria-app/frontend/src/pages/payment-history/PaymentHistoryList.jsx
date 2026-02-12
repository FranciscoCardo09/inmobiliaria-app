// PaymentHistoryList - Historial de Pagos
// Shows all payment transactions with filters and expandable detail rows
import { useState, useMemo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CurrencyDollarIcon,
  TrashIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { usePaymentTransactions } from '../../hooks/usePaymentTransactions'
import { useCategories } from '../../hooks/useCategories'
import { useTenants } from '../../hooks/useTenants'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import { LoadingPage } from '../../components/ui/Loading'

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const METHOD_LABELS = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
}

const CategoryBadge = ({ category }) => {
  if (!category) return null
  const colors = {
    blue: 'badge-info',
    green: 'badge-success',
    orange: 'badge-warning',
    red: 'badge-error',
    purple: 'badge-secondary',
  }
  return (
    <span className={`badge ${colors[category.color] || 'badge-ghost'} badge-xs`}>
      {category.name}
    </span>
  )
}

/**
 * Format a date string or Date object to dd/mm/yyyy in local timezone
 */
function formatDate(dateVal) {
  if (!dateVal) return '-'
  const d = new Date(dateVal)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

// Expandable transaction detail row
const TransactionDetailRow = ({ tx }) => {
  const concepts = tx.concepts || []
  const record = tx.monthlyRecord || {}

  return (
    <tr>
      <td colSpan="9" className="bg-base-200/50 p-0">
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Transaction info */}
            <div>
              <h4 className="text-sm font-semibold text-base-content/70 mb-1">Transacción</h4>
              <p className="text-sm">Fecha: {formatDate(tx.paymentDate)}</p>
              <p className="text-sm">Método: {METHOD_LABELS[tx.paymentMethod] || tx.paymentMethod}</p>
              {tx.receiptNumber && (
                <p className="text-sm flex items-center gap-1">
                  <DocumentTextIcon className="w-3.5 h-3.5" />
                  Recibo: {tx.receiptNumber}
                </p>
              )}
              <p className="text-sm mt-1">
                Período: Cuota #{record.monthNumber} — {MONTH_NAMES[(record.periodMonth || 1) - 1]} {record.periodYear}
              </p>
              {tx.punitoryForgiven && (
                <p className="text-sm text-warning font-medium mt-1">⚠ Punitorios condonados</p>
              )}
            </div>

            {/* Concepts breakdown */}
            <div className="md:col-span-2">
              <h4 className="text-sm font-semibold text-base-content/70 mb-1">Conceptos</h4>
              <div className="space-y-1">
                {concepts.map((c, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>
                      {c.type}
                      {c.description && (
                        <span className="text-base-content/50 ml-1">({c.description})</span>
                      )}
                    </span>
                    <span className={`font-medium ${c.amount < 0 ? 'text-success' : ''}`}>
                      {c.amount < 0 ? '-' : ''}${Math.abs(c.amount).toLocaleString('es-AR')}
                    </span>
                  </div>
                ))}
                <div className="border-t border-base-300 mt-2 pt-2 flex justify-between font-bold">
                  <span>Monto pagado</span>
                  <span className="text-success">${tx.amount?.toLocaleString('es-AR')}</span>
                </div>
                {tx.punitoryAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Punitorios incluidos</span>
                    <span className="text-error">${tx.punitoryAmount.toLocaleString('es-AR')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {tx.observations && (
            <div className="text-sm text-base-content/60 italic border-t border-base-300 pt-2">
              📝 {tx.observations}
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

export default function PaymentHistoryList() {
  const navigate = useNavigate()
  const { groups } = useAuthStore()
  const currentGroup = groups[0]
  const groupId = currentGroup?.id

  // Filters
  const now = new Date()
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1)
  const [periodYear, setPeriodYear] = useState(now.getFullYear())
  const [methodFilter, setMethodFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [tenantFilter, setTenantFilter] = useState('')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [showAllMonths, setShowAllMonths] = useState(false)

  // Build filters for query
  const filters = useMemo(() => {
    const f = {}
    if (!showAllMonths) {
      if (periodMonth) f.month = periodMonth
      if (periodYear) f.year = periodYear
    }
    if (methodFilter) f.paymentMethod = methodFilter
    if (categoryFilter) f.categoryId = categoryFilter
    if (tenantFilter) f.tenantId = tenantFilter
    if (search) f.search = search
    return f
  }, [periodMonth, periodYear, methodFilter, categoryFilter, tenantFilter, search, showAllMonths])

  const { transactions, isLoading, deleteTransaction, isDeleting } = usePaymentTransactions(groupId, filters)
  const { categories } = useCategories(groupId)
  const { tenants } = useTenants(groupId)

  const handleDelete = (e, tx) => {
    e.stopPropagation()
    const tenantName = tx.monthlyRecord?.contract?.tenant?.name || 'Desconocido'
    if (!window.confirm(`¿Eliminar transacción de ${tenantName} por $${tx.amount?.toLocaleString('es-AR')}?`)) return
    deleteTransaction(tx.id)
  }

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id)
  }

  // Year options
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear()
    return [current - 2, current - 1, current, current + 1]
  }, [])

  // Totals
  const totalPaid = useMemo(() => transactions.reduce((s, t) => s + (t.amount || 0), 0), [transactions])

  if (isLoading) return <LoadingPage />

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Historial de Pagos</h1>
          <p className="text-base-content/60 mt-1">{currentGroup?.name}</p>
        </div>
        <Button variant="primary" onClick={() => navigate('/monthly-control')}>
          <CurrencyDollarIcon className="w-5 h-5" />
          Registrar Pago
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <FunnelIcon className="w-5 h-5 text-base-content/60" />
          <span className="font-semibold text-sm">Filtros</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Month filter */}
          <div className="form-control">
            <label className="label py-0">
              <span className="label-text text-xs">Mes</span>
            </label>
            <select
              className="select select-bordered select-sm w-full"
              value={showAllMonths ? '' : periodMonth}
              onChange={(e) => {
                if (e.target.value === '') {
                  setShowAllMonths(true)
                } else {
                  setShowAllMonths(false)
                  setPeriodMonth(parseInt(e.target.value))
                }
              }}
            >
              <option value="">Todos</option>
              {MONTH_NAMES.map((name, i) => (
                <option key={i} value={i + 1}>{name}</option>
              ))}
            </select>
          </div>

          {/* Year filter */}
          <div className="form-control">
            <label className="label py-0">
              <span className="label-text text-xs">Año</span>
            </label>
            <select
              className="select select-bordered select-sm w-full"
              value={showAllMonths ? '' : periodYear}
              onChange={(e) => {
                if (e.target.value === '') {
                  setShowAllMonths(true)
                } else {
                  setShowAllMonths(false)
                  setPeriodYear(parseInt(e.target.value))
                }
              }}
            >
              <option value="">Todos</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* Payment method filter */}
          <div className="form-control">
            <label className="label py-0">
              <span className="label-text text-xs">Método</span>
            </label>
            <select
              className="select select-bordered select-sm w-full"
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="EFECTIVO">Efectivo</option>
              <option value="TRANSFERENCIA">Transferencia</option>
            </select>
          </div>

          {/* Category filter */}
          <div className="form-control">
            <label className="label py-0">
              <span className="label-text text-xs">Categoría</span>
            </label>
            <select
              className="select select-bordered select-sm w-full"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">Todas</option>
              {(categories || []).map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          {/* Tenant filter */}
          <div className="form-control">
            <label className="label py-0">
              <span className="label-text text-xs">Inquilino</span>
            </label>
            <select
              className="select select-bordered select-sm w-full"
              value={tenantFilter}
              onChange={(e) => setTenantFilter(e.target.value)}
            >
              <option value="">Todos</option>
              {(tenants || []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Search */}
          <div className="form-control">
            <label className="label py-0">
              <span className="label-text text-xs">Buscar</span>
            </label>
            <div className="relative">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-base-content/40" />
              <input
                type="text"
                placeholder="Nombre, dirección, recibo..."
                className="input input-bordered input-sm w-full pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Quick filter info */}
        {!showAllMonths && (
          <div className="mt-2 text-sm text-base-content/60">
            Mostrando pagos de <strong>{MONTH_NAMES[periodMonth - 1]} {periodYear}</strong>
            <button
              className="link link-primary ml-2 text-sm"
              onClick={() => setShowAllMonths(true)}
            >
              Ver todos los meses
            </button>
          </div>
        )}
      </Card>

      {/* Results */}
      {transactions.length === 0 ? (
        <Card>
          <EmptyState
            icon={CurrencyDollarIcon}
            title="No hay pagos"
            description={
              showAllMonths
                ? 'No hay pagos registrados aún'
                : `No hay pagos para ${MONTH_NAMES[periodMonth - 1]} ${periodYear}`
            }
            action={{
              label: 'Ir a Control Mensual',
              onClick: () => navigate('/monthly-control'),
            }}
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th className="w-8"></th>
                  <th>Fecha</th>
                  <th>Inquilino</th>
                  <th>Propiedad</th>
                  <th className="text-center">Período</th>
                  <th className="text-center">Método</th>
                  <th className="text-right">Monto</th>
                  <th className="text-center">Recibo</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const record = tx.monthlyRecord || {}
                  const contract = record.contract || {}
                  const tenant = contract.tenant || {}
                  const property = contract.property || {}

                  return (
                    <Fragment key={tx.id}>
                      <tr
                        className="cursor-pointer hover:bg-base-200 transition-colors"
                        onClick={() => toggleExpand(tx.id)}
                      >
                        <td>
                          {expandedId === tx.id ? (
                            <ChevronUpIcon className="w-4 h-4" />
                          ) : (
                            <ChevronDownIcon className="w-4 h-4" />
                          )}
                        </td>
                        <td className="text-sm">{formatDate(tx.paymentDate)}</td>
                        <td>
                          <div className="font-medium">{tenant.name}</div>
                          <div className="text-xs text-base-content/50">{tenant.dni}</div>
                        </td>
                        <td>
                          <div className="text-sm">
                            {property.address}
                            {property.code && (
                              <span className="text-base-content/50"> ({property.code})</span>
                            )}
                          </div>
                          <CategoryBadge category={property.category} />
                        </td>
                        <td className="text-center text-sm">
                          #{record.monthNumber} — {MONTH_NAMES[(record.periodMonth || 1) - 1]?.slice(0, 3)} {record.periodYear}
                        </td>
                        <td className="text-center">
                          <span className={`badge badge-sm ${tx.paymentMethod === 'EFECTIVO' ? 'badge-ghost' : 'badge-info'}`}>
                            {METHOD_LABELS[tx.paymentMethod] || tx.paymentMethod}
                          </span>
                        </td>
                        <td className="text-right font-bold text-success">
                          ${tx.amount?.toLocaleString('es-AR')}
                        </td>
                        <td className="text-center text-xs text-base-content/50">
                          {tx.receiptNumber || '-'}
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-error"
                            onClick={(e) => handleDelete(e, tx)}
                            loading={isDeleting}
                          >
                            <TrashIcon className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                      {expandedId === tx.id && (
                        <TransactionDetailRow tx={tx} />
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          <div className="border-t border-base-300 mt-4 pt-4 flex flex-wrap gap-4 justify-end text-sm">
            <div>
              <span className="text-base-content/60">Transacciones: </span>
              <span className="font-bold">{transactions.length}</span>
            </div>
            <div>
              <span className="text-base-content/60">Total cobrado: </span>
              <span className="font-bold text-success">
                ${totalPaid.toLocaleString('es-AR')}
              </span>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
