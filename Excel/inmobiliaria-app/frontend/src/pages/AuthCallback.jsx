// Auth Callback Page - Handles Google OAuth redirect
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore } from '../stores/authStore'
import { LoadingPage } from '../components/ui/Loading'

export const AuthCallback = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { login } = useAuthStore()

  useEffect(() => {
    const processCallback = () => {
      try {
        // Extract tokens and user data from URL params
        const accessToken = searchParams.get('accessToken')
        const refreshToken = searchParams.get('refreshToken')
        const userId = searchParams.get('userId')
        const userName = searchParams.get('userName')
        const userEmail = searchParams.get('userEmail')
        const userAvatar = searchParams.get('userAvatar')
        const groupsJson = searchParams.get('groups')

        if (!accessToken || !refreshToken || !userId) {
          toast.error('Error de autenticación: datos incompletos')
          navigate('/login')
          return
        }

        // Parse groups
        let groups = []
        try {
          groups = groupsJson ? JSON.parse(groupsJson) : []
        } catch (e) {
          console.error('Error parsing groups:', e)
        }

        // Store auth data
        login({
          user: {
            id: userId,
            name: userName,
            email: userEmail,
            avatar: userAvatar || null,
          },
          groups,
          accessToken,
          refreshToken,
        })

        toast.success(`Bienvenido, ${userName}!`)
        navigate('/dashboard')
      } catch (error) {
        console.error('Callback error:', error)
        toast.error('Error procesando la autenticación')
        navigate('/login')
      }
    }

    processCallback()
  }, [searchParams, login, navigate])

  return <LoadingPage />
}

export default AuthCallback
