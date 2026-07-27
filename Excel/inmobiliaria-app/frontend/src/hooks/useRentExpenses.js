// useRentExpenses Hook - Gastos Alquiler (recibo de gastos de ingreso)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

// Catálogo de nombres de concepto reutilizables (propio de Gastos Alquiler,
// separado de ConceptType para no mezclarse con Control Mensual)
export const useRentExpenseConcepts = (groupId) => {
  const query = useQuery({
    queryKey: ['rent-expense-concepts', groupId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/rent-expenses/concepts`)
      return response.data.data
    },
    enabled: !!groupId,
    staleTime: 2 * 60 * 1000,
  })

  return {
    concepts: query.data || [],
    isLoading: query.isLoading,
  }
}

export const useRentExpenseReceipts = (groupId, filters = {}) => {
  const params = new URLSearchParams()
  if (filters.search) params.append('search', filters.search)
  if (filters.from) params.append('from', filters.from)
  if (filters.to) params.append('to', filters.to)

  const query = useQuery({
    queryKey: ['rent-expense-receipts', groupId, filters],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/rent-expenses?${params}`)
      return response.data.data
    },
    enabled: !!groupId,
    staleTime: 30 * 1000,
  })

  return {
    receipts: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
  }
}

export const useCreateRentExpenseReceipt = (groupId) => {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post(`/groups/${groupId}/rent-expenses`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rent-expense-receipts', groupId] })
      queryClient.invalidateQueries({ queryKey: ['rent-expense-concepts', groupId] })
      toast.success('Recibo generado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al generar el recibo')
    },
  })

  return {
    createReceipt: mutation.mutateAsync,
    isCreating: mutation.isPending,
  }
}

export const useDeleteRentExpenseReceipt = (groupId) => {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/groups/${groupId}/rent-expenses/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rent-expense-receipts', groupId] })
      toast.success('Recibo eliminado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al eliminar el recibo')
    },
  })

  return {
    deleteReceipt: mutation.mutate,
    isDeleting: mutation.isPending,
  }
}

export const useDownloadRentExpenseReceipt = (groupId) => {
  const download = async (id, receiptNumber) => {
    try {
      const response = await api.get(`/groups/${groupId}/rent-expenses/${id}/pdf`, { responseType: 'blob' })
      const blob = new Blob([response.data], { type: response.headers['content-type'] })
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `recibo-gastos-${receiptNumber}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(downloadUrl)
    } catch (error) {
      toast.error(error.response?.data?.message || 'Error al descargar el recibo')
    }
  }

  return { download }
}
