// useAdjustmentIndices Hook
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const useAdjustmentIndices = (groupId) => {
  const queryClient = useQueryClient()

  const indicesQuery = useQuery({
    queryKey: ['adjustmentIndices', groupId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/adjustment-indices`)
      return response.data.data
    },
    enabled: !!groupId,
  })

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post(`/groups/${groupId}/adjustment-indices`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['adjustmentIndices', groupId])
      toast.success('Índice de ajuste creado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al crear índice')
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }) => {
      const response = await api.put(`/groups/${groupId}/adjustment-indices/${id}`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['adjustmentIndices', groupId])
      toast.success('Índice actualizado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al actualizar índice')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/groups/${groupId}/adjustment-indices/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['adjustmentIndices', groupId])
      toast.success('Índice eliminado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al eliminar índice')
    },
  })

  // Fetch contract adjustments (this month / next month)
  const adjustmentsQuery = useQuery({
    queryKey: ['contractAdjustments', groupId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/contracts/adjustments`)
      return response.data.data
    },
    enabled: !!groupId,
  })

  // Apply adjustment percentage to contracts
  const applyAdjustmentMutation = useMutation({
    mutationFn: async ({ indexId, percentageIncrease }) => {
      const response = await api.post(
        `/groups/${groupId}/adjustment-indices/${indexId}/apply`,
        { percentageIncrease }
      )
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['adjustmentIndices', groupId])
      queryClient.invalidateQueries(['contractAdjustments', groupId])
      queryClient.invalidateQueries(['contracts', groupId])
      queryClient.invalidateQueries(['dashboard', 'summary', groupId])
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al aplicar ajuste')
    },
  })

  // Apply ALL adjustments at once
  const applyAllMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(
        `/groups/${groupId}/adjustments/apply-all-next-month`
      )
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['adjustmentIndices', groupId])
      queryClient.invalidateQueries(['contractAdjustments', groupId])
      queryClient.invalidateQueries(['contracts', groupId])
      queryClient.invalidateQueries(['dashboard', 'summary', groupId])
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al aplicar ajustes')
    },
  })

  // Get contracts for specific month
  const getContractsForMonth = async (targetMonth) => {
    const response = await api.get(
      `/groups/${groupId}/adjustments/contracts-by-month/${targetMonth}`
    )
    return response.data.data
  }

  // Apply adjustment to specific month
  const applyToMonthMutation = useMutation({
    mutationFn: async ({ indexId, percentageIncrease, targetMonth }) => {
      const response = await api.post(
        `/groups/${groupId}/adjustment-indices/${indexId}/apply-to-month`,
        { percentageIncrease, targetMonth }
      )
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['adjustmentIndices', groupId])
      queryClient.invalidateQueries(['contractAdjustments', groupId])
      queryClient.invalidateQueries(['contracts', groupId])
      queryClient.invalidateQueries(['dashboard', 'summary', groupId])
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al aplicar ajuste')
    },
  })

  // Undo adjustment for specific month
  const undoMonthMutation = useMutation({
    mutationFn: async ({ indexId, targetMonth }) => {
      const response = await api.post(
        `/groups/${groupId}/adjustment-indices/${indexId}/undo-month`,
        { targetMonth }
      )
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['adjustmentIndices', groupId])
      queryClient.invalidateQueries(['contractAdjustments', groupId])
      queryClient.invalidateQueries(['contracts', groupId])
      queryClient.invalidateQueries(['dashboard', 'summary', groupId])
      toast.success('Ajuste revertido correctamente')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al deshacer ajuste')
    },
  })

  return {
    indices: indicesQuery.data || [],
    isLoading: indicesQuery.isLoading,
    createIndex: createMutation.mutate,
    updateIndex: updateMutation.mutate,
    deleteIndex: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    adjustments: adjustmentsQuery.data || { thisMonth: [], nextMonth: [], thisMonthCount: 0, nextMonthCount: 0 },
    isLoadingAdjustments: adjustmentsQuery.isLoading,
    applyIndexAdjustment: applyAdjustmentMutation.mutate,
    isApplying: applyAdjustmentMutation.isPending,
    applyAllNextMonth: applyAllMutation.mutate,
    isApplyingAll: applyAllMutation.isPending,
    getContractsForMonth,
    applyToMonth: applyToMonthMutation.mutate,
    isApplyingToMonth: applyToMonthMutation.isPending,
    undoMonth: undoMonthMutation.mutate,
    isUndoingMonth: undoMonthMutation.isPending,
  }
}
