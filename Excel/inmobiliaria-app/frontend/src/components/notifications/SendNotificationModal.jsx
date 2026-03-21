// SendNotificationModal - Channel selection and send confirmation
import { useState, useMemo } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import {
  EnvelopeIcon,
  PhoneIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
} from '@heroicons/react/24/outline'

const NOTIFICATION_TYPE_LABELS = {
  NEXT_MONTH: 'Liquidación Mes Siguiente',
  DEBT_TOTAL: 'Deuda Total',
  DEBT_PARTIAL: 'Saldo Pendiente',
  LATE_PAYMENT: 'Pago Atrasado',
  ADJUSTMENT: 'Ajuste de Alquiler',
  CONTRACT_EXPIRING: 'Contrato por Vencer',
  CASH_RECEIPT: 'Recibo de Pago',
  REPORT_OWNER: 'Reporte al Propietario',
}

export default function SendNotificationModal({
  isOpen,
  onClose,
  type,
  recipients = [],
  recipientType = 'TENANT',
  onSend,
  isSending = false,
}) {
  const [channels, setChannels] = useState(['EMAIL'])

  const toggleChannel = (ch) => {
    setChannels(prev => {
      if (prev.includes(ch)) {
        const next = prev.filter(c => c !== ch)
        return next.length > 0 ? next : prev // At least one channel
      }
      return [...prev, ch]
    })
  }

  // Calculate warnings and effective send counts
  const { withEmail, withPhone, withoutEmail, withoutPhone, effectiveSends } = useMemo(() => {
    const withEmail = recipients.filter(r => r.email)
    const withPhone = recipients.filter(r => r.phone)
    const withoutEmail = recipients.filter(r => !r.email)
    const withoutPhone = recipients.filter(r => !r.phone)

    let effectiveSends = 0
    if (channels.includes('EMAIL')) effectiveSends += withEmail.length
    if (channels.includes('WHATSAPP')) effectiveSends += withPhone.length

    return { withEmail, withPhone, withoutEmail, withoutPhone, effectiveSends }
  }, [recipients, channels])

  const handleSend = () => {
    if (effectiveSends === 0) return
    onSend({ channels })
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Enviar Notificaciones"
      size="md"
      actions={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isSending}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={isSending || effectiveSends === 0}
            loading={isSending}
          >
            <PaperAirplaneIcon className="w-4 h-4 mr-1" />
            Enviar {effectiveSends > 0 && `(${effectiveSends})`}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Notification type */}
        <div className="bg-base-200 rounded-lg p-3">
          <div className="text-sm text-base-content/60">Tipo</div>
          <div className="font-semibold">{NOTIFICATION_TYPE_LABELS[type] || type}</div>
          <div className="text-sm mt-1">
            {recipients.length} {recipientType === 'OWNER' ? 'propietario(s)' : 'inquilino(s)'} seleccionado(s)
          </div>
        </div>

        {/* Channel selection */}
        <div>
          <div className="text-sm font-semibold mb-2">Canal de envío</div>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="checkbox checkbox-sm checkbox-primary"
                checked={channels.includes('EMAIL')}
                onChange={() => toggleChannel('EMAIL')}
              />
              <EnvelopeIcon className="w-4 h-4" />
              <span className="text-sm">Email</span>
              <span className="badge badge-sm badge-ghost">{withEmail.length}/{recipients.length}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="checkbox checkbox-sm checkbox-success"
                checked={channels.includes('WHATSAPP')}
                onChange={() => toggleChannel('WHATSAPP')}
              />
              <PhoneIcon className="w-4 h-4" />
              <span className="text-sm">WhatsApp</span>
              <span className="badge badge-sm badge-ghost">{withPhone.length}/{recipients.length}</span>
            </label>
          </div>
        </div>

        {/* Warnings */}
        {channels.includes('EMAIL') && withoutEmail.length > 0 && (
          <div className="alert alert-warning text-sm py-2">
            <ExclamationTriangleIcon className="w-4 h-4" />
            <span>
              {withoutEmail.length} sin email: {withoutEmail.map(r => r.name).join(', ')}
            </span>
          </div>
        )}
        {channels.includes('WHATSAPP') && withoutPhone.length > 0 && (
          <div className="alert alert-warning text-sm py-2">
            <ExclamationTriangleIcon className="w-4 h-4" />
            <span>
              {withoutPhone.length} sin teléfono: {withoutPhone.map(r => r.name).join(', ')}
            </span>
          </div>
        )}

        {/* Effective sends summary */}
        <div className="bg-base-200 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-primary">{effectiveSends}</div>
          <div className="text-sm text-base-content/60">
            notificaciones se enviarán
          </div>
        </div>
      </div>
    </Modal>
  )
}
