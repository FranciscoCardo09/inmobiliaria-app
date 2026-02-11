// usePaymentTransactions Hook - Phase 5
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const usePaymentTransactions = (groupId, filters = {}) => {
  const queryClient = useQueryClient()

  const params = new URLSearchParams()
  if (filters.contractId) params.append('contractId', filters.contractId)
  if (filters.month) params.append('month', filters.month)
  if (filters.year) params.append('year', filters.year)
  if (filters.paymentMethod) params.append('paymentMethod', filters.paymentMethod)
  if (filters.tenantId) params.append('tenantId', filters.tenantId)
  if (filters.categoryId) params.append('categoryId', filters.categoryId)
  if (filters.search) params.append('search', filters.search)

  const transactionsQuery = useQuery({
    queryKey: ['paymentTransactions', groupId, filters],
    queryFn: async () => {
      const response = await api.get(
        `/groups/${groupId}/payment-transactions?${params.toString()}`
      )
      return response.data.data
    },
    enabled: !!groupId,
  })

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['paymentTransactions'], refetchType: 'active' }),
      queryClient.invalidateQueries({ queryKey: ['monthlyRecords'], refetchType: 'active' }),
      queryClient.invalidateQueries({ queryKey: ['monthlyRecord'], refetchType: 'active' }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'active' }),
      queryClient.invalidateQueries({ queryKey: ['debts'], refetchType: 'active' }),
      queryClient.invalidateQueries({ queryKey: ['debtsSummary'], refetchType: 'active' }),
      // Invalidar deuda individual y preview de punitorios (usado por DebtPaymentModal)
      queryClient.invalidateQueries({ queryKey: ['debt'], refetchType: 'active' }),
      queryClient.invalidateQueries({ queryKey: ['debtPunitoryPreview'], refetchType: 'active' }),
      queryClient.invalidateQueries({ queryKey: ['canPayCurrentMonth'], refetchType: 'active' }),
    ])
  }

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post(
        `/groups/${groupId}/payment-transactions`,
        data
      )
      return response.data.data
    },
    onSuccess: async () => {
      await invalidateAll()
      toast.success('Pago registrado exitosamente')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al registrar pago')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/groups/${groupId}/payment-transactions/${id}`)
    },
    onSuccess: async () => {
      await invalidateAll()
      toast.success('Transacción eliminada')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al eliminar')
    },
  })

  return {
    transactions: transactionsQuery.data?.transactions || [],
    total: transactionsQuery.data?.total || 0,
    isLoading: transactionsQuery.isLoading,
    registerPayment: createMutation.mutateAsync,
    deleteTransaction: deleteMutation.mutate,
    isRegistering: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}

export const usePunitoryPreview = (groupId, monthlyRecordId, paymentDate) => {
  return useQuery({
    queryKey: ['punitoryPreview', groupId, monthlyRecordId, paymentDate],
    queryFn: async () => {
      const params = new URLSearchParams({ monthlyRecordId, paymentDate })
      const response = await api.get(
        `/groups/${groupId}/payment-transactions/calculate-punitorios?${params.toString()}`
      )
      return response.data.data
    },
    enabled: !!groupId && !!monthlyRecordId && !!paymentDate,
  })
}
