// useDebts Hook - Phase 5+ Debt management
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const useDebts = (groupId, filters = {}) => {
  const queryClient = useQueryClient()

  const params = new URLSearchParams()
  if (filters.status) params.append('status', filters.status)
  if (filters.contractId) params.append('contractId', filters.contractId)

  const debtsQuery = useQuery({
    queryKey: ['debts', groupId, filters],
    queryFn: async () => {
      const endpoint = filters.status === 'OPEN'
        ? `/groups/${groupId}/debts/open`
        : `/groups/${groupId}/debts?${params.toString()}`
      const response = await api.get(endpoint)
      return response.data.data
    },
    enabled: !!groupId,
    staleTime: 2 * 60 * 1000,
  })

  const summaryQuery = useQuery({
    queryKey: ['debtsSummary', groupId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/debts/summary`)
      return response.data.data
    },
    enabled: !!groupId,
    staleTime: 2 * 60 * 1000,
  })

  // Shared invalidation for debt mutations — scoped to groupId
  const invalidateDebtRelated = async (debtId) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['debt', groupId, debtId] }),
      queryClient.invalidateQueries({ queryKey: ['debts', groupId] }),
      queryClient.invalidateQueries({ queryKey: ['debtsSummary', groupId] }),
      queryClient.invalidateQueries({ queryKey: ['monthlyRecords', groupId] }),
      queryClient.invalidateQueries({ queryKey: ['canPayCurrentMonth', groupId] }),
      queryClient.invalidateQueries({ queryKey: ['debtPunitoryPreview', groupId, debtId] }),
      queryClient.invalidateQueries({ queryKey: ['paymentTransactions', groupId] }),
    ])
  }

  const payDebtMutation = useMutation({
    mutationFn: async ({ debtId, ...data }) => {
      const response = await api.post(`/groups/${groupId}/debts/${debtId}/pay`, data)
      return { updatedDebt: response.data.data.debt, debtId }
    },
    onSuccess: async (data, variables) => {
      await invalidateDebtRelated(variables.debtId)
      toast.success('Pago de deuda registrado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al pagar deuda')
    },
  })

  const cancelPaymentMutation = useMutation({
    mutationFn: async ({ debtId, paymentId }) => {
      const response = await api.delete(`/groups/${groupId}/debts/${debtId}/payments/${paymentId}`)
      return { updatedDebt: response.data.data, debtId, paymentId }
    },
    onSuccess: async (data, variables) => {
      await invalidateDebtRelated(variables.debtId)
      toast.success('Pago de deuda anulado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al anular pago')
    },
  })

  return {
    debts: debtsQuery.data || [],
    isLoading: debtsQuery.isLoading,
    summary: summaryQuery.data || {},
    isSummaryLoading: summaryQuery.isLoading,
    payDebt: payDebtMutation.mutateAsync,
    isPaying: payDebtMutation.isPending,
    cancelPayment: cancelPaymentMutation.mutateAsync,
    isCancelingPayment: cancelPaymentMutation.isPending,
  }
}

export const useDebt = (groupId, debtId) => {
  return useQuery({
    queryKey: ['debt', groupId, debtId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/debts/${debtId}`)
      return response.data.data
    },
    enabled: !!groupId && !!debtId,
    staleTime: 60 * 1000,
  })
}

export const useCanPayCurrentMonth = (groupId, contractId) => {
  return useQuery({
    queryKey: ['canPayCurrentMonth', groupId, contractId],
    queryFn: async () => {
      const response = await api.get(
        `/groups/${groupId}/contracts/${contractId}/can-pay-current-month`
      )
      return response.data.data
    },
    enabled: !!groupId && !!contractId,
    staleTime: 2 * 60 * 1000,
  })
}

export const useDebtPunitoryPreview = (groupId, debtId, paymentDate) => {
  return useQuery({
    queryKey: ['debtPunitoryPreview', groupId, debtId, paymentDate],
    queryFn: async () => {
      const params = new URLSearchParams({ paymentDate })
      const response = await api.get(
        `/groups/${groupId}/debts/${debtId}/punitory-preview?${params.toString()}`
      )
      return response.data.data
    },
    enabled: !!groupId && !!debtId && !!paymentDate,
    staleTime: 30 * 1000,
  })
}

export const useCloseMonth = (groupId) => {
  const queryClient = useQueryClient()

  const previewMutation = useMutation({
    mutationFn: async ({ month, year }) => {
      const response = await api.post(`/groups/${groupId}/close-month/preview`, { month, year })
      return response.data.data
    },
  })

  const closeMutation = useMutation({
    mutationFn: async ({ month, year }) => {
      const response = await api.post(`/groups/${groupId}/close-month`, { month, year })
      return response.data.data
    },
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['debts', groupId] }),
        queryClient.invalidateQueries({ queryKey: ['debtsSummary', groupId] }),
        queryClient.invalidateQueries({ queryKey: ['monthlyRecords', groupId] }),
        queryClient.invalidateQueries({ queryKey: ['canPayCurrentMonth', groupId] }),
      ])
      toast.success(`Mes cerrado: ${data.debtsCreated} deudas generadas`)
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al cerrar mes')
    },
  })

  return {
    previewClose: previewMutation.mutateAsync,
    isPreviewing: previewMutation.isPending,
    previewData: previewMutation.data,
    closeMonth: closeMutation.mutateAsync,
    isClosing: closeMutation.isPending,
  }
}
