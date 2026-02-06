// usePayments Hook - Phase 4
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const usePayments = (groupId) => {
  const queryClient = useQueryClient()

  // Current month payments
  const currentMonthQuery = useQuery({
    queryKey: ['payments', 'currentMonth', groupId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/payments/current-month`)
      return response.data.data
    },
    enabled: !!groupId,
  })

  // Next month projections
  const nextMonthQuery = useQuery({
    queryKey: ['payments', 'nextMonth', groupId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/payments/next-month`)
      return response.data.data
    },
    enabled: !!groupId,
  })

  // All payments (with filters)
  const allPaymentsQuery = useQuery({
    queryKey: ['payments', groupId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/payments`)
      return response.data.data
    },
    enabled: !!groupId,
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries(['payments', groupId])
    queryClient.invalidateQueries(['payments', 'currentMonth', groupId])
    queryClient.invalidateQueries(['payments', 'nextMonth', groupId])
    queryClient.invalidateQueries(['dashboard', 'summary', groupId])
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
    currentMonthPayments: currentMonthQuery.data || [],
    nextMonthPayments: nextMonthQuery.data || [],
    payments: allPaymentsQuery.data || [],
    isLoadingCurrentMonth: currentMonthQuery.isLoading,
    isLoadingNextMonth: nextMonthQuery.isLoading,
    isLoading: allPaymentsQuery.isLoading,
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
  })
}
