// PaymentList - Phase 4
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PlusIcon,
  CurrencyDollarIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { usePayments } from '../../hooks/usePayments'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import { LoadingPage } from '../../components/ui/Loading'
import toast from 'react-hot-toast'

const StatusBadge = ({ status }) => {
  const config = {
    COMPLETE: { label: 'Pagado', cls: 'badge-success' },
    PARTIAL: { label: 'Parcial', cls: 'badge-warning' },
    PENDING: { label: 'Pendiente', cls: 'badge-error' },
  }
  const c = config[status] || config.PENDING
  return <span className={`badge ${c.cls} badge-sm`}>{c.label}</span>
}

export const PaymentList = () => {
  const navigate = useNavigate()
  const { groups } = useAuthStore()
  const currentGroup = groups[0]

  const { payments, isLoading, deletePayment, isDeleting } = usePayments(
    currentGroup?.id
  )

  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  const filteredPayments = payments.filter((p) => {
    if (statusFilter && p.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      const tenantName = p.contract?.tenant?.name?.toLowerCase() || ''
      const propertyAddr = p.contract?.property?.address?.toLowerCase() || ''
      if (!tenantName.includes(q) && !propertyAddr.includes(q)) return false
    }
    return true
  })

  const handleDelete = (payment) => {
    const confirmResult = window.confirm(
      `¿Eliminar pago de ${payment.contract?.tenant?.name} - Mes ${payment.monthNumber}?`
    )
    if (!confirmResult) return
    deletePayment(payment.id)
  }

  if (isLoading) return <LoadingPage />

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Pagos</h1>
          <p className="text-base-content/60 mt-1">{currentGroup?.name}</p>
        </div>
        <Button variant="primary" onClick={() => navigate('/payments/new')}>
          <PlusIcon className="w-5 h-5" />
          Nuevo Pago
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Buscar por inquilino o propiedad..."
          className="input input-bordered input-sm w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="select select-bordered select-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Todos los estados</option>
          <option value="COMPLETE">Pagado</option>
          <option value="PARTIAL">Parcial</option>
          <option value="PENDING">Pendiente</option>
        </select>
      </div>

      {filteredPayments.length === 0 ? (
        <Card>
          <EmptyState
            icon={CurrencyDollarIcon}
            title="No hay pagos"
            description={
              payments.length === 0
                ? 'Registra tu primer pago'
                : 'No hay pagos que coincidan con los filtros'
            }
            action={{
              label: 'Nuevo Pago',
              onClick: () => navigate('/payments/new'),
            }}
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Inquilino</th>
                  <th>Propiedad</th>
                  <th className="text-center">Mes</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Pagado</th>
                  <th className="text-center">Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.map((p) => (
                  <tr
                    key={p.id}
                    className="cursor-pointer hover:bg-base-200"
                    onClick={() => navigate(`/payments/${p.id}`)}
                  >
                    <td className="text-sm">
                      {p.paymentDate
                        ? new Date(p.paymentDate).toLocaleDateString('es-AR')
                        : '-'}
                    </td>
                    <td className="font-medium">
                      {p.contract?.tenant?.name}
                    </td>
                    <td className="text-sm text-base-content/70">
                      {p.contract?.property?.address}
                      {p.contract?.property?.code &&
                        ` (${p.contract.property.code})`}
                    </td>
                    <td className="text-center">{p.monthNumber}</td>
                    <td className="text-right font-bold">
                      ${p.totalDue?.toLocaleString('es-AR')}
                    </td>
                    <td className="text-right">
                      ${p.amountPaid?.toLocaleString('es-AR')}
                    </td>
                    <td className="text-center">
                      <StatusBadge status={p.status} />
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-error"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(p)
                        }}
                        loading={isDeleting}
                      >
                        <TrashIcon className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

export default PaymentList
