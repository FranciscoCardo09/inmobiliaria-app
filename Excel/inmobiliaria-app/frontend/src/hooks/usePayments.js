// usePayments Hook - Phase 4 v2
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const usePayments = (groupId, filters = {}) => {
  const queryClient = useQueryClient()

  // Build query params from filters
  const params = new URLSearchParams()
  if (filters.periodMonth) params.append('periodMonth', filters.periodMonth)
  if (filters.periodYear) params.append('periodYear', filters.periodYear)
  if (filters.status) params.append('status', filters.status)
  if (filters.categoryId) params.append('categoryId', filters.categoryId)
  if (filters.tenantId) params.append('tenantId', filters.tenantId)
  if (filters.search) params.append('search', filters.search)

  // Filtered payments query
  const paymentsQuery = useQuery({
    queryKey: ['payments', groupId, filters],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/payments?${params}`)
      return response.data.data
    },
    enabled: !!groupId,
    staleTime: 2 * 60 * 1000,
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['payments'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  // Create payment
  const createMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post(`/groups/${groupId}/payments`, data)
      return response.data.data
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Pago registrado exitosamente')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al registrar pago')
    },
  })

  // Update payment
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }) => {
      const response = await api.put(`/groups/${groupId}/payments/${id}`, data)
      return response.data.data
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Pago actualizado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al actualizar pago')
    },
  })

  // Delete payment
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/groups/${groupId}/payments/${id}`)
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Pago eliminado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al eliminar pago')
    },
  })

  return {
    payments: paymentsQuery.data || [],
    isLoading: paymentsQuery.isLoading,
    createPayment: createMutation.mutate,
    updatePayment: updateMutation.mutate,
    deletePayment: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}

// Hook for payment calculation preview
export const usePaymentCalculation = (groupId, contractId, paymentDate) => {
  return useQuery({
    queryKey: ['paymentCalc', groupId, contractId, paymentDate],
    queryFn: async () => {
      const params = new URLSearchParams({ contractId })
      if (paymentDate) params.append('paymentDate', paymentDate)
      const response = await api.get(
        `/groups/${groupId}/payments/calculate?${params.toString()}`
      )
      return response.data.data
    },
    enabled: !!groupId && !!contractId,
    staleTime: 2 * 60 * 1000,
  })
}

// Hook for concept types CRUD
export const useConceptTypes = (groupId) => {
  const queryClient = useQueryClient()

  const conceptTypesQuery = useQuery({
    queryKey: ['conceptTypes', groupId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/payments/concept-types`)
      return response.data.data
    },
    enabled: !!groupId,
    staleTime: 5 * 60 * 1000,
  })

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post(`/groups/${groupId}/payments/concept-types`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conceptTypes', groupId] })
      toast.success('Concepto creado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al crear concepto')
    },
  })

  const seedDefaultsMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/groups/${groupId}/payments/concept-types/seed-defaults`)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conceptTypes', groupId] })
      toast.success('Conceptos por defecto creados')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al crear conceptos')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/groups/${groupId}/payments/concept-types/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conceptTypes', groupId] })
      toast.success('Concepto eliminado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error')
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }) => {
      const response = await api.put(`/groups/${groupId}/payments/concept-types/${id}`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conceptTypes', groupId] })
      toast.success('Concepto actualizado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al actualizar')
    },
  })

  return {
    conceptTypes: conceptTypesQuery.data || [],
    isLoading: conceptTypesQuery.isLoading,
    createConceptType: createMutation.mutate,
    updateConceptType: updateMutation.mutate,
    seedDefaults: seedDefaultsMutation.mutate,
    deleteConceptType: deleteMutation.mutate,
    isCreating: createMutation.isPending,
  }
}
