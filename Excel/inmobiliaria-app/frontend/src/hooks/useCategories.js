// useCategories Hook - Manage categories with TanStack Query
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const useCategories = (groupId) => {
  const queryClient = useQueryClient()

  // Fetch categories
  const categoriesQuery = useQuery({
    queryKey: ['categories', groupId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/categories`)
      return response.data.data
    },
    enabled: !!groupId,
  })

  // Create category
  const createMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post(`/groups/${groupId}/categories`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['categories', groupId])
      toast.success('Categoría creada')
    },
    onError: (error) => {
      const message = error.response?.data?.message || 'Error al crear categoría'
      toast.error(message)
    },
  })

  // Update category
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }) => {
      const response = await api.put(`/groups/${groupId}/categories/${id}`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['categories', groupId])
      toast.success('Categoría actualizada')
    },
    onError: (error) => {
      const message = error.response?.data?.message || 'Error al actualizar categoría'
      toast.error(message)
    },
  })

  // Delete category
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/groups/${groupId}/categories/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['categories', groupId])
      toast.success('Categoría eliminada')
    },
    onError: (error) => {
      const message = error.response?.data?.message || 'Error al eliminar categoría'
      toast.error(message)
    },
  })

  return {
    categories: categoriesQuery.data || [],
    isLoading: categoriesQuery.isLoading,
    error: categoriesQuery.error,
    createCategory: createMutation.mutate,
    updateCategory: updateMutation.mutate,
    deleteCategory: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
