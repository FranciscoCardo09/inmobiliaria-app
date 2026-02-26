// useOwners Hook - Manage property owners with TanStack Query
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const useOwners = (groupId, filters = {}) => {
  const queryClient = useQueryClient()

  const params = new URLSearchParams()
  if (filters.search) params.append('search', filters.search)

  const ownersQuery = useQuery({
    queryKey: ['owners', groupId, filters],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/owners?${params}`)
      return response.data.data
    },
    enabled: !!groupId,
    staleTime: 2 * 60 * 1000,
  })

  const useOwner = (ownerId) => {
    return useQuery({
      queryKey: ['owner', groupId, ownerId],
      queryFn: async () => {
        const response = await api.get(`/groups/${groupId}/owners/${ownerId}`)
        return response.data.data
      },
      enabled: !!groupId && !!ownerId,
      staleTime: 2 * 60 * 1000,
    })
  }

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post(`/groups/${groupId}/owners`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['owners', groupId])
      toast.success('Dueño creado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al crear dueño')
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }) => {
      const response = await api.put(`/groups/${groupId}/owners/${id}`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['owners', groupId])
      toast.success('Dueño actualizado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al actualizar dueño')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/groups/${groupId}/owners/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['owners', groupId])
      toast.success('Dueño eliminado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al eliminar dueño')
    },
  })

  return {
    owners: ownersQuery.data || [],
    isLoading: ownersQuery.isLoading,
    error: ownersQuery.error,
    useOwner,
    createOwner: createMutation.mutate,
    updateOwner: updateMutation.mutate,
    deleteOwner: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
