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
    staleTime: 2 * 60 * 1000,
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['monthlyServices', groupId] })
    queryClient.invalidateQueries({ queryKey: ['monthlyRecords', groupId] })
    queryClient.invalidateQueries({ queryKey: ['monthlyRecord', groupId] })
  }

  const addMutation = useMutation({
    mutationFn: async ({ propagateForward, ...data }) => {
      const response = await api.post(
        `/groups/${groupId}/monthly-records/${recordId}/services`,
        { ...data, propagateForward: !!propagateForward }
      )
      return response.data.data
    },
    onSuccess: (_, variables) => {
      invalidateAll()
      toast.success(variables.propagateForward ? 'Servicio agregado a este mes y los siguientes' : 'Servicio agregado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al agregar servicio')
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ serviceId, propagateForward, ...data }) => {
      const response = await api.put(
        `/groups/${groupId}/monthly-records/${recordId}/services/${serviceId}`,
        { ...data, propagateForward: !!propagateForward }
      )
      return response.data.data
    },
    onSuccess: (_, variables) => {
      invalidateAll()
      toast.success(variables.propagateForward ? 'Servicio actualizado en este mes y los siguientes' : 'Servicio actualizado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al actualizar')
    },
  })

  const removeMutation = useMutation({
    mutationFn: async ({ serviceId, propagateForward }) => {
      const params = propagateForward ? '?propagateForward=true' : ''
      await api.delete(
        `/groups/${groupId}/monthly-records/${recordId}/services/${serviceId}${params}`
      )
      return { propagateForward }
    },
    onSuccess: (data) => {
      invalidateAll()
      toast.success(data.propagateForward ? 'Servicio eliminado de este mes y los siguientes' : 'Servicio eliminado')
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
    removeService: (serviceIdOrObj) =>
      removeMutation.mutate(
        typeof serviceIdOrObj === 'string'
          ? { serviceId: serviceIdOrObj, propagateForward: false }
          : serviceIdOrObj
      ),
    isAdding: addMutation.isPending,
  }
}
