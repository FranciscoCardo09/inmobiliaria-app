// useContracts Hook - Manage contracts with TanStack Query
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const useContracts = (groupId, filters = {}) => {
  const queryClient = useQueryClient()

  const params = new URLSearchParams()
  if (filters.status) params.append('status', filters.status)
  if (filters.propertyId) params.append('propertyId', filters.propertyId)
  if (filters.tenantId) params.append('tenantId', filters.tenantId)
  if (filters.search) params.append('search', filters.search)

  const contractsQuery = useQuery({
    queryKey: ['contracts', groupId, filters],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/contracts?${params}`)
      return response.data.data
    },
    enabled: !!groupId,
  })

  const useContract = (contractId) => {
    return useQuery({
      queryKey: ['contract', groupId, contractId],
      queryFn: async () => {
        const response = await api.get(`/groups/${groupId}/contracts/${contractId}`)
        return response.data.data
      },
      enabled: !!groupId && !!contractId,
    })
  }

  const expiringQuery = useQuery({
    queryKey: ['contracts', 'expiring', groupId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/contracts/expiring`)
      return response.data.data
    },
    enabled: !!groupId,
  })

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post(`/groups/${groupId}/contracts`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['contracts', groupId])
      queryClient.invalidateQueries(['contracts', 'expiring', groupId])
      queryClient.invalidateQueries(['contractAdjustments', groupId])
      toast.success('Contrato creado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al crear contrato')
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }) => {
      const response = await api.put(`/groups/${groupId}/contracts/${id}`, data)
      return response.data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['contracts', groupId])
      queryClient.invalidateQueries(['contracts', 'expiring', groupId])
      queryClient.invalidateQueries(['contractAdjustments', groupId])
      toast.success('Contrato actualizado')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al actualizar contrato')
    },
  })

  return {
    contracts: contractsQuery.data || [],
    isLoading: contractsQuery.isLoading,
    error: contractsQuery.error,
    useContract,
    expiringContracts: expiringQuery.data || [],
    isLoadingExpiring: expiringQuery.isLoading,
    createContract: createMutation.mutate,
    updateContract: updateMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
  }
}
