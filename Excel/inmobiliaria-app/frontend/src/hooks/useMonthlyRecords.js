// useMonthlyRecords Hook - Phase 5
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const useMonthlyRecords = (groupId, periodMonth, periodYear, filters = {}) => {
  const queryClient = useQueryClient()

  const params = new URLSearchParams()
  params.append('month', periodMonth)
  params.append('year', periodYear)
  if (filters.status) params.append('status', filters.status)
  if (filters.search) params.append('search', filters.search)
  if (filters.categoryId) params.append('categoryId', filters.categoryId)

  const recordsQuery = useQuery({
    queryKey: ['monthlyRecords', groupId, periodMonth, periodYear, filters],
    queryFn: async () => {
      const response = await api.get(
        `/groups/${groupId}/monthly-records?${params.toString()}`
      )
      return response.data.data
    },
    enabled: !!groupId && !!periodMonth && !!periodYear,
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }) => {
      const response = await api.put(
        `/groups/${groupId}/monthly-records/${id}`,
        data
      )
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monthlyRecords'] })
      toast.success('Registro actualizado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al actualizar')
    },
  })

  const generateMutation = useMutation({
    mutationFn: async ({ month, year }) => {
      const response = await api.post(
        `/groups/${groupId}/monthly-records/generate`,
        { month, year }
      )
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monthlyRecords'] })
      toast.success('Registros generados')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al generar')
    },
  })

  return {
    records: recordsQuery.data?.records || [],
    summary: recordsQuery.data?.summary || {},
    isLoading: recordsQuery.isLoading,
    refetch: recordsQuery.refetch,
    updateRecord: updateMutation.mutate,
    generateRecords: generateMutation.mutate,
    isUpdating: updateMutation.isPending,
  }
}

export const useMonthlyRecordDetail = (groupId, recordId) => {
  return useQuery({
    queryKey: ['monthlyRecord', groupId, recordId],
    queryFn: async () => {
      const response = await api.get(
        `/groups/${groupId}/monthly-records/${recordId}`
      )
      return response.data.data
    },
    enabled: !!groupId && !!recordId,
  })
}
