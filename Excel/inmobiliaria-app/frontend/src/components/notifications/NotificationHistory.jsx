// NotificationHistory - Table showing sent notifications with filters
import { useState } from 'react'
import {
  EnvelopeIcon,
  PhoneIcon,
  FunnelIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'

const TYPE_LABELS = {
  NEXT_MONTH: 'Aviso mes',
  DEBT_TOTAL: 'Deuda total',
  DEBT_PARTIAL: 'Deuda parcial',
  LATE_PAYMENT: 'Pago tardío',
  ADJUSTMENT: 'Ajuste',
  CONTRACT_EXPIRING: 'Vencimiento',
  CASH_RECEIPT: 'Recibo',
  REPORT_OWNER: 'Reporte dueño',
  REPORT_TENANT: 'Reporte inquilino',
}

const STATUS_CONFIG = {
  SENT: { class: 'badge-success', text: 'Enviado', icon: CheckCircleIcon },
  FAILED: { class: 'badge-error', text: 'Fallido', icon: XCircleIcon },
  PENDING: { class: 'badge-warning', text: 'Pendiente', icon: ClockIcon },
}

const CHANNEL_ICON = {
  EMAIL: EnvelopeIcon,
  WHATSAPP: PhoneIcon,
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function NotificationHistory({ logs = [], isLoading }) {
  const [typeFilter, setTypeFilter] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const filtered = logs.filter((log) => {
    if (typeFilter && log.type !== typeFilter) return false
    if (channelFilter && log.channel !== channelFilter) return false
    if (statusFilter && log.status !== statusFilter) return false
    return true
  })

  if (isLoading) {
    return (
      <Card>
        <div className="flex justify-center py-8">
          <span className="loading loading-spinner loading-md"></span>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <Card compact>
        <div className="flex items-center gap-2 flex-wrap">
          <FunnelIcon className="w-4 h-4" />
          <span className="text-sm font-semibold">Filtros</span>

          <select
            className="select select-bordered select-xs"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">Todos los tipos</option>
            {Object.entries(TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          <select
            className="select select-bordered select-xs"
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
          >
            <option value="">Todos los canales</option>
            <option value="EMAIL">Email</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>

          <select
            className="select select-bordered select-xs"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Todos los estados</option>
            <option value="SENT">Enviados</option>
            <option value="FAILED">Fallidos</option>
            <option value="PENDING">Pendientes</option>
          </select>

          <span className="text-xs text-base-content/50 ml-auto">
            {filtered.length} resultado(s)
          </span>
        </div>
      </Card>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          title="Sin notificaciones"
          description="No hay notificaciones que coincidan con los filtros"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table table-sm table-zebra">
              <thead>
                <tr className="bg-base-200">
                  <th className="text-xs">Fecha</th>
                  <th className="text-xs">Tipo</th>
                  <th className="text-xs">Destinatario</th>
                  <th className="text-xs text-center">Canal</th>
                  <th className="text-xs text-center">Estado</th>
                  <th className="text-xs">Error</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => {
                  const ChannelIcon = CHANNEL_ICON[log.channel] || EnvelopeIcon
                  const statusCfg = STATUS_CONFIG[log.status] || STATUS_CONFIG.PENDING
                  return (
                    <tr key={log.id}>
                      <td className="text-xs whitespace-nowrap">
                        {formatDate(log.sentAt || log.createdAt)}
                      </td>
                      <td className="text-xs">
                        <span className="badge badge-ghost badge-xs">
                          {TYPE_LABELS[log.type] || log.type}
                        </span>
                      </td>
                      <td className="text-xs">
                        <div className="font-medium">{log.recipientName || '-'}</div>
                        <div className="text-base-content/50 text-[10px]">
                          {log.recipientEmail || log.recipientPhone || '-'}
                        </div>
                      </td>
                      <td className="text-center">
                        <ChannelIcon className="w-4 h-4 inline" title={log.channel} />
                      </td>
                      <td className="text-center">
                        <span className={`badge badge-xs ${statusCfg.class}`}>
                          {statusCfg.text}
                        </span>
                      </td>
                      <td className="text-xs text-error max-w-[200px] truncate">
                        {log.errorMessage || '-'}
                      </td>
                    </tr>
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
