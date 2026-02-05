// Accept Invite Page
import { useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { EnvelopeOpenIcon } from '@heroicons/react/24/outline'
import { useGroups } from '../hooks/useGroups'
import { useAuthStore } from '../stores/authStore'
import Button from '../components/ui/Button'
import { LoadingPage } from '../components/ui/Loading'

export const AcceptInvite = () => {
  const { token } = useParams()
  const navigate = useNavigate()
  const { acceptInvite, isAccepting } = useGroups()
  const { isAuthenticated } = useAuthStore()

  // If not authenticated, redirect to login with return URL
  useEffect(() => {
    if (!isAuthenticated) {
      navigate(`/login?redirect=/invite/${token}`)
    }
  }, [isAuthenticated, navigate, token])

  const handleAccept = () => {
    acceptInvite(token, {
      onSuccess: () => {
        navigate('/dashboard')
      },
    })
  }

  if (!isAuthenticated) {
    return <LoadingPage />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center p-4">
      <div className="card w-full max-w-md bg-base-100 shadow-xl">
        <div className="card-body text-center">
          <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <EnvelopeOpenIcon className="w-10 h-10 text-primary" />
          </div>

          <h1 className="text-2xl font-bold">Invitacion a Grupo</h1>
          <p className="text-base-content/60 mb-6">
            Has sido invitado a unirte a un grupo de trabajo.
            Haz clic en el boton para aceptar la invitacion.
          </p>

          <div className="space-y-3">
            <Button
              onClick={handleAccept}
              variant="primary"
              className="w-full"
              loading={isAccepting}
            >
              Aceptar Invitacion
            </Button>

            <Link to="/dashboard" className="btn btn-ghost w-full">
              Volver al Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AcceptInvite
