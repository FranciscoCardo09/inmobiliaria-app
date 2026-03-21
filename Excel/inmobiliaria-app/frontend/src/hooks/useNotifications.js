// useNotifications Hook - Notification system queries and mutations
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const useNotifications = (groupId) => {
  const queryClient = useQueryClient()

  const logQuery = useQuery({
    queryKey: ['notifications', 'log', groupId],
    queryFn: async () => {
      const res = await api.get(`/groups/${groupId}/notifications/log`)
      return res.data.data
    },
    enabled: !!groupId,
  })

  const statsQuery = useQuery({
    queryKey: ['notifications', 'stats', groupId],
    queryFn: async () => {
      const res = await api.get(`/groups/${groupId}/notifications/stats`)
      return res.data.data
    },
    enabled: !!groupId,
  })

  const createSendMutation = (endpoint) => useMutation({
    mutationFn: async (body) => {
      const res = await api.post(`/groups/${groupId}/notifications/${endpoint}`, body)
      return res.data.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      if (data.sent > 0) toast.success(`${data.sent} notificaciones enviadas`)
      if (data.failed > 0) toast.error(`${data.failed} fallaron`)
      if (data.skipped > 0) toast(`${data.skipped} omitidos (sin contacto)`, { icon: '⚠️' })
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Error enviando notificaciones'),
  })

  return {
    log: logQuery.data || { logs: [], total: 0 },
    stats: statsQuery.data || {},
    isLoadingLog: logQuery.isLoading,
    isLoadingStats: statsQuery.isLoading,
    sendNextMonth: createSendMutation('next-month'),
    sendDebtors: createSendMutation('debtors'),
    sendAdjustments: createSendMutation('adjustments'),
    sendContractExpiring: createSendMutation('contract-expiring'),
    sendCashReceipt: createSendMutation('cash-receipt'),
    sendOwnerReport: createSendMutation('report-owner'),
  }
}
