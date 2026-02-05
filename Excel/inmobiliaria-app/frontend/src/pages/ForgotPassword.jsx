// Forgot Password Page
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BuildingOfficeIcon, EnvelopeIcon, ArrowLeftIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import api from '../services/api'

export const ForgotPassword = () => {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [error, setError] = useState('')

  const validate = () => {
    if (!email) {
      setError('Email es requerido')
      return false
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError('Email invalido')
      return false
    }
    setError('')
    return true
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return

    setIsLoading(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setEmailSent(true)
      toast.success('Revisa tu correo para restablecer tu contrasena')
    } catch (err) {
      // Don't reveal if email exists or not
      setEmailSent(true)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center p-4">
      <div className="card w-full max-w-md bg-base-100 shadow-xl">
        <div className="card-body">
          {/* Logo */}
          <div className="flex flex-col items-center mb-6">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mb-4">
              <BuildingOfficeIcon className="w-10 h-10 text-primary-content" />
            </div>
            <h1 className="text-2xl font-bold">Restablecer Contrasena</h1>
            <p className="text-base-content/60 text-center mt-2">
              Ingresa tu email y te enviaremos instrucciones
            </p>
          </div>

          {emailSent ? (
            <div className="text-center space-y-4">
              <div className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mx-auto">
                <EnvelopeIcon className="w-10 h-10 text-success" />
              </div>
              <h2 className="text-xl font-semibold">Revisa tu correo</h2>
              <p className="text-base-content/60">
                Si existe una cuenta con el email <strong>{email}</strong>,
                recibiras un enlace para restablecer tu contrasena.
              </p>
              <p className="text-sm text-base-content/50">
                El enlace expira en 1 hora.
              </p>
              <Link to="/login" className="btn btn-primary w-full mt-4">
                <ArrowLeftIcon className="w-4 h-4 mr-2" />
                Volver al Login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Email"
                type="email"
                name="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (error) setError('')
                }}
                error={error}
              />

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                loading={isLoading}
              >
                Enviar Instrucciones
              </Button>

              <div className="text-center">
                <Link to="/login" className="text-sm link link-primary">
                  <ArrowLeftIcon className="w-4 h-4 inline mr-1" />
                  Volver al Login
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default ForgotPassword
