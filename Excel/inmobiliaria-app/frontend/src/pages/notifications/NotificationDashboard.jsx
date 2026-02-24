// NotificationDashboard - Dashboard page for notification log and stats
import { useAuthStore } from '../../stores/authStore'
import { useNotifications } from '../../hooks/useNotifications'
import Card from '../../components/ui/Card'
import { LoadingPage } from '../../components/ui/Loading'
import NotificationHistory from '../../components/notifications/NotificationHistory'
import {
  BellIcon,
  CheckCircleIcon,
  XCircleIcon,
  EnvelopeIcon,
  PhoneIcon,
} from '@heroicons/react/24/outline'

export default function NotificationDashboard() {
  const currentGroupId = useAuthStore((s) => s.currentGroupId)
  const { log, stats, isLoadingLog, isLoadingStats } = useNotifications(currentGroupId)

  if (isLoadingLog && isLoadingStats) return <LoadingPage />

  const totalSent = stats.totalSent || 0
  const totalFailed = stats.totalFailed || 0
  const byChannel = stats.byChannel || {}
  const byType = stats.byType || {}

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BellIcon className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Notificaciones</h1>
          <p className="text-sm text-base-content/60">
            Historial y estadísticas de notificaciones enviadas
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card compact>
          <div className="flex items-center gap-2">
            <CheckCircleIcon className="w-5 h-5 text-success" />
            <div>
              <div className="text-xs text-base-content/60">Enviadas</div>
              <div className="text-lg font-bold text-success">{totalSent}</div>
            </div>
          </div>
        </Card>

        <Card compact>
          <div className="flex items-center gap-2">
            <XCircleIcon className="w-5 h-5 text-error" />
            <div>
              <div className="text-xs text-base-content/60">Fallidas</div>
              <div className="text-lg font-bold text-error">{totalFailed}</div>
            </div>
          </div>
        </Card>

        <Card compact>
          <div className="flex items-center gap-2">
            <EnvelopeIcon className="w-5 h-5 text-info" />
            <div>
              <div className="text-xs text-base-content/60">Por Email</div>
              <div className="text-lg font-bold">{byChannel.EMAIL || 0}</div>
            </div>
          </div>
        </Card>

        <Card compact>
          <div className="flex items-center gap-2">
            <PhoneIcon className="w-5 h-5 text-success" />
            <div>
              <div className="text-xs text-base-content/60">Por WhatsApp</div>
              <div className="text-lg font-bold">{byChannel.WHATSAPP || 0}</div>
            </div>
          </div>
        </Card>
      </div>

      {/* By Type breakdown */}
      {Object.keys(byType).length > 0 && (
        <Card compact>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">Por tipo:</span>
            {Object.entries(byType).map(([type, count]) => (
              <span key={type} className="badge badge-ghost badge-sm">
                {type}: {count}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* History table */}
      <NotificationHistory logs={log.logs || []} isLoading={isLoadingLog} />
    </div>
  )
}
