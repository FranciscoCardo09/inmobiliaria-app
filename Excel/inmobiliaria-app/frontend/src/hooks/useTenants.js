// useTenants Hook - Manage tenants with TanStack Query
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const useTenants = (groupId, filters = {}) => {
  const queryClient = useQueryClient()

  // Build query params
  const params = new URLSearchParams()
  if (filters.search) params.append('search', filters.search)
  if (filters.isActive !== undefined) params.append('isActive', filters.isActive)

  // Fetch tenants
  const tenantsQuery = useQuery({
    queryKey: ['tenants', groupId, filters],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/tenants?${params}`)
      return response.data.data
    },
    enabled: !!groupId,
    staleTime: 2 * 60 * 1000,
  })

  // Fetch single tenant
  const useTenant = (tenantId) => {
    return useQuery({
      queryKey: ['tenant', groupId, tenantId],
      queryFn: async () => {
        const response = await api.get(`/groups/${groupId}/tenants/${tenantId}`)
        return response.data.data
      },
      enabled: !!groupId && !!tenantId,
      staleTime: 2 * 60 * 1000,
    })
  }

  // Fetch tenant history
  const useTenantHistory = (tenantId) => {
    return useQuery({
      queryKey: ['tenantHistory', groupId, tenantId],
      queryFn: async () => {
        const response = await api.get(`/groups/${groupId}/tenants/${tenantId}/history`)
        return response.data.data
      },
      enabled: !!groupId && !!tenantId,
      staleTime: 2 * 60 * 1000,
    })
  }

  // Create tenant
  const createMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post(`/groups/${groupId}/tenants`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['tenants', groupId])
      toast.success('Inquilino creado')
    },
    onError: (error) => {
      const message = error.response?.data?.message || 'Error al crear inquilino'
      toast.error(message)
    },
  })

  // Update tenant
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }) => {
      const response = await api.put(`/groups/${groupId}/tenants/${id}`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['tenants', groupId])
      toast.success('Inquilino actualizado')
    },
    onError: (error) => {
      const message = error.response?.data?.message || 'Error al actualizar inquilino'
      toast.error(message)
    },
  })

  // Delete tenant
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/groups/${groupId}/tenants/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['tenants', groupId])
      toast.success('Inquilino eliminado')
    },
    onError: (error) => {
      const message = error.response?.data?.message || 'Error al eliminar inquilino'
      toast.error(message)
    },
  })

  return {
    tenants: tenantsQuery.data || [],
    isLoading: tenantsQuery.isLoading,
    error: tenantsQuery.error,
    useTenant,
    useTenantHistory,
    createTenant: createMutation.mutate,
    updateTenant: updateMutation.mutate,
    deleteTenant: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
