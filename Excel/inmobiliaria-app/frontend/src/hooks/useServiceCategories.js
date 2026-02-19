// useServiceCategories Hook - Manage dynamic service categories
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const useServiceCategories = (groupId) => {
  const queryClient = useQueryClient()

  const categoriesQuery = useQuery({
    queryKey: ['serviceCategories', groupId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/service-categories`)
      return response.data.data
    },
    enabled: !!groupId,
  })

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post(`/groups/${groupId}/service-categories`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serviceCategories', groupId] })
      toast.success('Categoría creada')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al crear categoría')
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }) => {
      const response = await api.put(`/groups/${groupId}/service-categories/${id}`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serviceCategories', groupId] })
      toast.success('Categoría actualizada')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al actualizar')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/groups/${groupId}/service-categories/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serviceCategories', groupId] })
      toast.success('Categoría eliminada')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al eliminar')
    },
  })

  const seedDefaultsMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/groups/${groupId}/service-categories/seed-defaults`)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serviceCategories', groupId] })
      toast.success('Categorías por defecto creadas')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error')
    },
  })

  return {
    serviceCategories: categoriesQuery.data || [],
    isLoading: categoriesQuery.isLoading,
    createServiceCategory: createMutation.mutate,
    updateServiceCategory: updateMutation.mutate,
    deleteServiceCategory: deleteMutation.mutate,
    seedDefaults: seedDefaultsMutation.mutate,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
