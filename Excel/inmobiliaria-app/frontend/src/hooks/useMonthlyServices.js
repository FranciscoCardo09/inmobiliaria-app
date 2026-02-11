// useMonthlyServices Hook - Phase 5
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const useMonthlyServices = (groupId, recordId) => {
  const queryClient = useQueryClient()

  const servicesQuery = useQuery({
    queryKey: ['monthlyServices', groupId, recordId],
    queryFn: async () => {
      const response = await api.get(
        `/groups/${groupId}/monthly-records/${recordId}/services`
      )
      return response.data.data
    },
    enabled: !!groupId && !!recordId,
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['monthlyServices'] })
    queryClient.invalidateQueries({ queryKey: ['monthlyRecords'] })
    queryClient.invalidateQueries({ queryKey: ['monthlyRecord'] })
  }

  const addMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post(
        `/groups/${groupId}/monthly-records/${recordId}/services`,
        data
      )
      return response.data.data
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Servicio agregado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al agregar servicio')
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ serviceId, ...data }) => {
      const response = await api.put(
        `/groups/${groupId}/monthly-records/${recordId}/services/${serviceId}`,
        data
      )
      return response.data.data
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Servicio actualizado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al actualizar')
    },
  })

  const removeMutation = useMutation({
    mutationFn: async (serviceId) => {
      await api.delete(
        `/groups/${groupId}/monthly-records/${recordId}/services/${serviceId}`
      )
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Servicio eliminado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al eliminar')
    },
  })

  return {
    services: servicesQuery.data || [],
    isLoading: servicesQuery.isLoading,
    addService: addMutation.mutate,
    updateService: updateMutation.mutate,
    removeService: removeMutation.mutate,
    isAdding: addMutation.isPending,
  }
}
