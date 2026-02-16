// Register Page
import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { BuildingOfficeIcon, EnvelopeIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { useAuthStore } from '../stores/authStore'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import api from '../services/api'

// Google Icon SVG
const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
)

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

export const Register = () => {
  const { isAuthenticated } = useAuthStore()
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [errors, setErrors] = useState({})
  const [isLoading, setIsLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [registrationSuccess, setRegistrationSuccess] = useState(false)
  const [registeredEmail, setRegisteredEmail] = useState('')

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }))
    }
  }

  const validate = () => {
    const newErrors = {}
    if (!formData.name || formData.name.length < 2) {
      newErrors.name = 'Nombre debe tener al menos 2 caracteres'
    }
    if (!formData.email) {
      newErrors.email = 'Email es requerido'
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email invalido'
    }
    if (!formData.password || formData.password.length < 8) {
      newErrors.password = 'Password debe tener al menos 8 caracteres'
    }
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Los passwords no coinciden'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return

    setIsLoading(true)
    try {
      await api.post('/auth/register', {
        name: formData.name,
        email: formData.email,
        password: formData.password,
      })
      setRegisteredEmail(formData.email)
      setRegistrationSuccess(true)
      toast.success('Cuenta creada. Revisa tu email')
    } catch (err) {
      const message = err.response?.data?.message || 'Error al registrar'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleSignup = () => {
    setGoogleLoading(true)
    window.location.href = `${API_URL}/auth/google`
  }

  // Show success message after registration
  if (registrationSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center p-4">
        <div className="card w-full max-w-md bg-base-100 shadow-xl">
          <div className="card-body text-center">
            <div className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <EnvelopeIcon className="w-10 h-10 text-success" />
            </div>
            <h1 className="text-2xl font-bold">Revisa tu Email</h1>
            <p className="text-base-content/60 mt-2">
              Hemos enviado un enlace de verificacion a:
            </p>
            <p className="font-semibold text-lg mt-2">{registeredEmail}</p>
            <p className="text-sm text-base-content/50 mt-4">
              Haz click en el enlace para verificar tu cuenta y comenzar a usar la plataforma.
            </p>
            <p className="text-sm text-base-content/50 mt-2">
              El enlace expira en 24 horas.
            </p>
            <Link to="/login" className="btn btn-primary w-full mt-6">
              Ir al Login
            </Link>
          </div>
        </div>
      </div>
    )
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
            <h1 className="text-2xl font-bold">Crear Cuenta</h1>
            <p className="text-base-content/60">Registrate para comenzar</p>
          </div>

          {/* Google Signup Button - only show if configured */}
          {import.meta.env.VITE_GOOGLE_AUTH_ENABLED === 'true' && (
            <>
              <button
                onClick={handleGoogleSignup}
                disabled={googleLoading}
                className="btn btn-outline w-full gap-3 mb-4 hover:bg-base-200"
              >
                {googleLoading ? (
                  <span className="loading loading-spinner loading-sm"></span>
                ) : (
                  <GoogleIcon />
                )}
                Registrarse con Google
              </button>

              <div className="divider text-sm text-base-content/40">o con email</div>
            </>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Nombre"
              type="text"
              name="name"
              placeholder="Tu nombre"
              value={formData.name}
              onChange={handleChange}
              error={errors.name}
            />

            <Input
              label="Email"
              type="email"
              name="email"
              placeholder="tu@email.com"
              value={formData.email}
              onChange={handleChange}
              error={errors.email}
            />

            <Input
              label="Password"
              type="password"
              name="password"
              placeholder="Minimo 8 caracteres"
              value={formData.password}
              onChange={handleChange}
              error={errors.password}
            />

            <Input
              label="Confirmar Password"
              type="password"
              name="confirmPassword"
              placeholder="Repite tu password"
              value={formData.confirmPassword}
              onChange={handleChange}
              error={errors.confirmPassword}
            />

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              loading={isLoading}
            >
              Crear Cuenta
            </Button>
          </form>

          {/* Login link */}
          <div className="divider">o</div>

          <p className="text-center text-sm">
            Ya tienes cuenta?{' '}
            <Link to="/login" className="link link-primary font-medium">
              Inicia Sesion
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default Register
