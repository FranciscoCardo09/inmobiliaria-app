// Login Page
import { useState, useEffect } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { BuildingOfficeIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { useAuthStore } from '../stores/authStore'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'

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

export const Login = () => {
  const { login, isLoading } = useAuth()
  const { isAuthenticated } = useAuthStore()
  const [searchParams] = useSearchParams()
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  })
  const [errors, setErrors] = useState({})
  const [googleLoading, setGoogleLoading] = useState(false)

  // Handle Google auth error from URL params
  useEffect(() => {
    const error = searchParams.get('error')
    if (error) {
      const messages = {
        google_auth_failed: 'Error al autenticar con Google',
        no_user: 'No se pudo obtener la información del usuario',
        callback_failed: 'Error en el proceso de autenticación',
      }
      toast.error(messages[error] || 'Error de autenticación')
    }
  }, [searchParams])

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
    if (!formData.email) {
      newErrors.email = 'Email es requerido'
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email invalido'
    }
    if (!formData.password) {
      newErrors.password = 'Password es requerido'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (validate()) {
      login(formData)
    }
  }

  const handleGoogleLogin = () => {
    setGoogleLoading(true)
    // Redirect to backend Google OAuth endpoint
    window.location.href = `${API_URL}/auth/google`
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
            <h1 className="text-2xl font-bold">Inmobiliaria</h1>
            <p className="text-base-content/60">Sistema de Gestion</p>
          </div>

          {/* Google Login Button */}
          <button
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            className="btn btn-outline w-full gap-3 mb-4 hover:bg-base-200"
          >
            {googleLoading ? (
              <span className="loading loading-spinner loading-sm"></span>
            ) : (
              <GoogleIcon />
            )}
            Continuar con Google
          </button>

          <div className="divider text-sm text-base-content/40">o con email</div>

          {/* Email/Password Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
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
              placeholder="********"
              value={formData.password}
              onChange={handleChange}
              error={errors.password}
            />

            <div className="text-right">
              <Link to="/forgot-password" className="text-sm link link-primary">
                Olvidaste tu contrasena?
              </Link>
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              loading={isLoading}
            >
              Iniciar Sesion
            </Button>
          </form>

          {/* Register link */}
          <div className="divider">o</div>

          <p className="text-center text-sm">
            No tienes cuenta?{' '}
            <Link to="/register" className="link link-primary font-medium">
              Registrate
            </Link>
          </p>

          {/* Test credentials */}
          <div className="mt-4 p-3 bg-base-200 rounded-lg">
            <p className="text-xs font-medium text-base-content/60 mb-2">
              Credenciales de prueba:
            </p>
            <code className="text-xs">
              admin@hh.com / Password123
            </code>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Login
