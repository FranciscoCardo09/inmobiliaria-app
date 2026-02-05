// Verify Email Page
import { useState, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { BuildingOfficeIcon, CheckCircleIcon, XCircleIcon, EnvelopeIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { useAuthStore } from '../stores/authStore'
import api from '../services/api'

export const VerifyEmail = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')
  const { setUser, setTokens } = useAuthStore()

  const [status, setStatus] = useState('verifying') // verifying, success, error, no-token
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!token) {
      setStatus('no-token')
      return
    }

    const verifyEmail = async () => {
      try {
        const response = await api.post('/auth/verify-email', { token })
        const { user, accessToken, refreshToken } = response.data.data

        // Auto-login user
        setUser(user)
        setTokens(accessToken, refreshToken)

        setStatus('success')
        toast.success('Email verificado correctamente')

        // Redirect to dashboard after 3 seconds
        setTimeout(() => {
          navigate('/dashboard')
        }, 3000)
      } catch (err) {
        setStatus('error')
        setErrorMessage(err.response?.data?.message || 'Error al verificar email')
        toast.error('Error al verificar email')
      }
    }

    verifyEmail()
  }, [token, navigate, setUser, setTokens])

  if (status === 'verifying') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center p-4">
        <div className="card w-full max-w-md bg-base-100 shadow-xl">
          <div className="card-body text-center">
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
              <EnvelopeIcon className="w-10 h-10 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Verificando Email</h1>
            <p className="text-base-content/60 mt-2">
              Por favor espera mientras verificamos tu email...
            </p>
            <span className="loading loading-spinner loading-lg text-primary mt-4"></span>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'no-token') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center p-4">
        <div className="card w-full max-w-md bg-base-100 shadow-xl">
          <div className="card-body text-center">
            <div className="w-20 h-20 bg-warning/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <EnvelopeIcon className="w-10 h-10 text-warning" />
            </div>
            <h1 className="text-2xl font-bold">Token Faltante</h1>
            <p className="text-base-content/60 mt-2">
              No se encontro el token de verificacion.
              Revisa el enlace en tu correo o solicita uno nuevo.
            </p>
            <Link to="/login" className="btn btn-primary w-full mt-4">
              Ir al Login
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center p-4">
        <div className="card w-full max-w-md bg-base-100 shadow-xl">
          <div className="card-body text-center">
            <div className="w-20 h-20 bg-error/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <XCircleIcon className="w-10 h-10 text-error" />
            </div>
            <h1 className="text-2xl font-bold">Error de Verificacion</h1>
            <p className="text-base-content/60 mt-2">
              {errorMessage}
            </p>
            <div className="space-y-2 mt-4">
              <Link to="/login" className="btn btn-primary w-full">
                Ir al Login
              </Link>
              <p className="text-sm text-base-content/50">
                Si tu enlace expiro, puedes solicitar uno nuevo desde el login.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Success
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center p-4">
      <div className="card w-full max-w-md bg-base-100 shadow-xl">
        <div className="card-body text-center">
          <div className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircleIcon className="w-10 h-10 text-success" />
          </div>
          <h1 className="text-2xl font-bold">Email Verificado</h1>
          <p className="text-base-content/60 mt-2">
            Tu email ha sido verificado exitosamente.
            Seras redirigido al dashboard en unos segundos...
          </p>
          <span className="loading loading-dots loading-md text-primary mt-4"></span>
          <Link to="/dashboard" className="btn btn-primary w-full mt-4">
            Ir al Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}

export default VerifyEmail
