// useDashboard Hook - Phase 3.5
import { useQuery } from '@tanstack/react-query'
import api from '../services/api'

export const useDashboard = (groupId) => {
  const summaryQuery = useQuery({
    queryKey: ['dashboard', 'summary', groupId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/dashboard/summary`)
      return response.data.data
    },
    enabled: !!groupId,
    refetchInterval: 60000,
  })

  return {
    summary: summaryQuery.data || {
      propertiesCount: 0,
      tenantsCount: 0,
      activeContracts: 0,
      adjustmentsThisMonth: 0,
      adjustmentsNextMonth: 0,
      contractsExpiring: 0,
      paymentsThisMonth: { paid: 0, total: 0 },
      pendingDebts: 0,
    },
    isLoading: summaryQuery.isLoading,
  }
}
