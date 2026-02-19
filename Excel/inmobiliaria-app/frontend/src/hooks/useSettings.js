// useSettings Hook - Group company settings
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const useSettings = (groupId) => {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['settings', groupId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/settings`)
      return response.data.data
    },
    enabled: !!groupId,
  })

  const mutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.put(`/groups/${groupId}/settings`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', groupId] })
      toast.success('Configuración guardada')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al guardar configuración')
    },
  })

  return {
    settings: query.data,
    isLoading: query.isLoading,
    error: query.error,
    updateSettings: mutation.mutate,
    isUpdating: mutation.isPending,
  }
}
