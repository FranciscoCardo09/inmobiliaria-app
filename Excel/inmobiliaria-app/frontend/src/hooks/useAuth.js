// Auth Hook - handles authentication logic
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { authAPI } from '../services/api'
import { useAuthStore } from '../stores/authStore'

export const useAuth = () => {
  const navigate = useNavigate()
  const {
    user,
    groups,
    isAuthenticated,
    login: setLogin,
    logout: clearAuth,
    setUser,
    setGroups,
    setPendingInvites,
    setLoading,
  } = useAuthStore()

  // Register mutation
  const registerMutation = useMutation({
    mutationFn: authAPI.register,
    onSuccess: (response) => {
      // New flow: don't auto-login, show verification message
      toast.success('Revisa tu correo para verificar tu cuenta', {
        duration: 5000,
        icon: '📧',
      })
      navigate('/login')
    },
    onError: (error) => {
      const message = error.response?.data?.message || 'Error al registrar'
      toast.error(message)
    },
  })

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: authAPI.login,
    onSuccess: (response) => {
      const data = response.data.data
      setLogin(data)
      toast.success(`Bienvenido, ${data.user.name}`)
      navigate('/dashboard')
    },
    onError: (error) => {
      const message = error.response?.data?.message || 'Credenciales invalidas'
      toast.error(message)
    },
  })

  // Me query - fetch current user
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const response = await authAPI.me()
      return response.data.data
    },
    enabled: isAuthenticated,
    onSuccess: (data) => {
      setUser(data.user)
      setGroups(data.groups)
      setPendingInvites(data.pendingInvites)
      setLoading(false)
    },
    onError: () => {
      setLoading(false)
    },
  })

  // Logout
  const logout = useCallback(async () => {
    const refreshToken = useAuthStore.getState().refreshToken
    try {
      if (refreshToken) {
        await authAPI.logout(refreshToken)
      }
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      clearAuth()
      toast.success('Sesion cerrada')
      navigate('/login')
    }
  }, [clearAuth, navigate])

  return {
    user,
    groups,
    isAuthenticated,
    register: registerMutation.mutate,
    login: loginMutation.mutate,
    logout,
    isLoading: registerMutation.isPending || loginMutation.isPending,
    refetchMe: meQuery.refetch,
  }
}
