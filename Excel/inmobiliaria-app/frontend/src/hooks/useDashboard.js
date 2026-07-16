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
    staleTime: 2 * 60 * 1000,
    // Antes: refetchInterval: 60000 (polling incondicional cada minuto).
    // Cada poll dispara getOrCreateMonthlyRecords + recálculo de deudas
    // (dashboard/summary), un ciclo pesado, aunque el usuario no toque nada.
    // El summary ya se invalida tras mutaciones relevantes (ver useDebts.js),
    // así que no hace falta un intervalo tan agresivo.
    refetchInterval: 5 * 60 * 1000,
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
