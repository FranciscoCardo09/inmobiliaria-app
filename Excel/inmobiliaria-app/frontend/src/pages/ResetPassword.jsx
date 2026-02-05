// Reset Password Page
import { useState, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { BuildingOfficeIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import api from '../services/api'

export const ResetPassword = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')

  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: '',
  })
  const [errors, setErrors] = useState({})
  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [isInvalidToken, setIsInvalidToken] = useState(false)

  useEffect(() => {
    if (!token) {
      setIsInvalidToken(true)
    }
  }, [token])

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }))
    }
  }

  const validate = () => {
    const newErrors = {}
    if (!formData.password) {
      newErrors.password = 'Contrasena es requerida'
    } else if (formData.password.length < 8) {
      newErrors.password = 'Minimo 8 caracteres'
    }
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Confirma tu contrasena'
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Las contrasenas no coinciden'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return

    setIsLoading(true)
    try {
      await api.post('/auth/reset-password', {
        token,
        password: formData.password,
      })
      setIsSuccess(true)
      toast.success('Contrasena actualizada correctamente')
    } catch (err) {
      const message = err.response?.data?.message || 'Error al restablecer contrasena'
      if (message.includes('invalido') || message.includes('expirado') || message.includes('utilizado')) {
        setIsInvalidToken(true)
      }
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  if (isInvalidToken) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center p-4">
        <div className="card w-full max-w-md bg-base-100 shadow-xl">
          <div className="card-body text-center">
            <div className="w-20 h-20 bg-error/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <XCircleIcon className="w-10 h-10 text-error" />
            </div>
            <h1 className="text-2xl font-bold">Enlace Invalido</h1>
            <p className="text-base-content/60 mt-2">
              Este enlace de restablecimiento es invalido o ha expirado.
              Solicita uno nuevo.
            </p>
            <Link to="/forgot-password" className="btn btn-primary w-full mt-4">
              Solicitar Nuevo Enlace
            </Link>
            <Link to="/login" className="btn btn-ghost w-full">
              Volver al Login
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center p-4">
        <div className="card w-full max-w-md bg-base-100 shadow-xl">
          <div className="card-body text-center">
            <div className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircleIcon className="w-10 h-10 text-success" />
            </div>
            <h1 className="text-2xl font-bold">Contrasena Actualizada</h1>
            <p className="text-base-content/60 mt-2">
              Tu contrasena ha sido actualizada exitosamente.
              Ya puedes iniciar sesion con tu nueva contrasena.
            </p>
            <Link to="/login" className="btn btn-primary w-full mt-4">
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
            <h1 className="text-2xl font-bold">Nueva Contrasena</h1>
            <p className="text-base-content/60 text-center mt-2">
              Ingresa tu nueva contrasena
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Nueva Contrasena"
              type="password"
              name="password"
              placeholder="********"
              value={formData.password}
              onChange={handleChange}
              error={errors.password}
            />

            <Input
              label="Confirmar Contrasena"
              type="password"
              name="confirmPassword"
              placeholder="********"
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
              Actualizar Contrasena
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}

export default ResetPassword
