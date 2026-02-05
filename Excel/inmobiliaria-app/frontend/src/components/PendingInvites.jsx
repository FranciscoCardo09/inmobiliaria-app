// Pending Invites Component
import { EnvelopeIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '../stores/authStore'
import { useGroups } from '../hooks/useGroups'
import Card from './ui/Card'
import Button from './ui/Button'

export const PendingInvites = () => {
  const { pendingInvites } = useAuthStore()
  const { acceptInvite, isAccepting } = useGroups()

  if (pendingInvites.length === 0) {
    return null
  }

  return (
    <Card
      title="Invitaciones Pendientes"
      className="bg-primary/5 border-primary/20"
    >
      <div className="space-y-3">
        {pendingInvites.map((invite) => (
          <div
            key={invite.id}
            className="flex items-center justify-between p-3 bg-base-100 rounded-lg"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                <EnvelopeIcon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">{invite.groupName}</p>
                <p className="text-sm text-base-content/60">
                  Invitado por {invite.invitedBy} como{' '}
                  <span className="badge badge-sm badge-ghost">{invite.role}</span>
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => acceptInvite(invite.token)}
                variant="success"
                size="sm"
                loading={isAccepting}
                className="gap-1"
              >
                <CheckIcon className="w-4 h-4" />
                Aceptar
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

export default PendingInvites
