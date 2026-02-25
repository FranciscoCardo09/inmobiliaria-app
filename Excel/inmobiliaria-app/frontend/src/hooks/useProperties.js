// useProperties Hook - Manage properties with TanStack Query
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const useProperties = (groupId, filters = {}) => {
  const queryClient = useQueryClient()

  // Build query params
  const params = new URLSearchParams()
  if (filters.categoryId) params.append('categoryId', filters.categoryId)
  if (filters.search) params.append('search', filters.search)
  if (filters.isActive !== undefined) params.append('isActive', filters.isActive)

  // Fetch properties
  const propertiesQuery = useQuery({
    queryKey: ['properties', groupId, filters],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/properties?${params}`)
      return response.data.data
    },
    enabled: !!groupId,
    staleTime: 2 * 60 * 1000,
  })

  // Fetch single property
  const useProperty = (propertyId) => {
    return useQuery({
      queryKey: ['property', groupId, propertyId],
      queryFn: async () => {
        const response = await api.get(`/groups/${groupId}/properties/${propertyId}`)
        return response.data.data
      },
      enabled: !!groupId && !!propertyId,
      staleTime: 2 * 60 * 1000,
    })
  }

  // Create property
  const createMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post(`/groups/${groupId}/properties`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['properties', groupId])
      toast.success('Propiedad creada')
    },
    onError: (error) => {
      const message = error.response?.data?.message || 'Error al crear propiedad'
      toast.error(message)
    },
  })

  // Update property
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }) => {
      const response = await api.put(`/groups/${groupId}/properties/${id}`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['properties', groupId])
      toast.success('Propiedad actualizada')
    },
    onError: (error) => {
      const message = error.response?.data?.message || 'Error al actualizar propiedad'
      toast.error(message)
    },
  })

  // Delete property
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/groups/${groupId}/properties/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['properties', groupId])
      toast.success('Propiedad eliminada')
    },
    onError: (error) => {
      const message = error.response?.data?.message || 'Error al eliminar propiedad'
      toast.error(message)
    },
  })

  return {
    properties: propertiesQuery.data || [],
    isLoading: propertiesQuery.isLoading,
    error: propertiesQuery.error,
    useProperty,
    createProperty: createMutation.mutate,
    updateProperty: updateMutation.mutate,
    deleteProperty: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
