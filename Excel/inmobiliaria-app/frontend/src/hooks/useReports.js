// useReports Hook - Report queries and download helpers
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const useLiquidacion = (groupId, { month, year, contractId } = {}) => {
  const query = useQuery({
    queryKey: ['report', 'liquidacion', groupId, month, year, contractId],
    queryFn: async () => {
      const params = new URLSearchParams({ month, year, contractId })
      const response = await api.get(`/groups/${groupId}/reports/liquidacion?${params}`)
      return response.data.data
    },
    enabled: !!groupId && !!month && !!year && !!contractId,
    staleTime: 60 * 1000,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export const useLiquidacionAll = (groupId, { month, year, propertyIds, honorariosPercent } = {}) => {
  const query = useQuery({
    queryKey: ['report', 'liquidacion-all', groupId, month, year, propertyIds, honorariosPercent],
    queryFn: async () => {
      const params = new URLSearchParams({ month, year })
      if (propertyIds && propertyIds.length > 0) {
        params.append('propertyIds', propertyIds.join(','))
      }
      if (honorariosPercent) {
        params.append('honorariosPercent', honorariosPercent)
      }
      const response = await api.get(`/groups/${groupId}/reports/liquidacion-all?${params}`)
      return response.data.data
    },
    enabled: !!groupId && !!month && !!year,
    staleTime: 60 * 1000,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  }
}

export const useEstadoCuentas = (groupId, { contractId } = {}) => {
  const query = useQuery({
    queryKey: ['report', 'estado-cuentas', groupId, contractId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/reports/estado-cuentas?contractId=${contractId}`)
      return response.data.data
    },
    enabled: !!groupId && !!contractId,
    staleTime: 60 * 1000,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  }
}

export const useResumenEjecutivo = (groupId, { month, year } = {}) => {
  const query = useQuery({
    queryKey: ['report', 'resumen-ejecutivo', groupId, month, year],
    queryFn: async () => {
      const params = new URLSearchParams({ month, year })
      const response = await api.get(`/groups/${groupId}/reports/resumen-ejecutivo?${params}`)
      return response.data.data
    },
    enabled: !!groupId && !!month && !!year,
    staleTime: 60 * 1000,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  }
}

export const useEvolucionIngresos = (groupId, { year } = {}) => {
  const query = useQuery({
    queryKey: ['report', 'evolucion-ingresos', groupId, year],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/reports/evolucion-ingresos?year=${year}`)
      return response.data.data
    },
    enabled: !!groupId && !!year,
    staleTime: 60 * 1000,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  }
}

export const useAjustesMes = (groupId, { month, year } = {}) => {
  const query = useQuery({
    queryKey: ['report', 'ajustes-mes', groupId, month, year],
    queryFn: async () => {
      const params = new URLSearchParams({ month, year })
      const response = await api.get(`/groups/${groupId}/reports/ajustes-mes?${params}`)
      return response.data.data
    },
    enabled: !!groupId && !!month && !!year,
    staleTime: 60 * 1000,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  }
}

export const useControlMensual = (groupId, { month, year } = {}) => {
  const query = useQuery({
    queryKey: ['report', 'control-mensual', groupId, month, year],
    queryFn: async () => {
      const params = new URLSearchParams({ month, year })
      const response = await api.get(`/groups/${groupId}/reports/control-mensual?${params}`)
      return response.data.data
    },
    enabled: !!groupId && !!month && !!year,
    staleTime: 60 * 1000,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  }
}

export const useImpuestos = (groupId, { month, year, propertyIds, ownerId } = {}) => {
  const query = useQuery({
    queryKey: ['report', 'impuestos', groupId, month, year, propertyIds, ownerId],
    queryFn: async () => {
      const params = new URLSearchParams({ month, year })
      if (propertyIds && propertyIds.length > 0) {
        params.append('propertyIds', propertyIds.join(','))
      }
      if (ownerId) {
        params.append('ownerId', ownerId)
      }
      const response = await api.get(`/groups/${groupId}/reports/impuestos?${params}`)
      return response.data.data
    },
    enabled: !!groupId && !!month && !!year,
    staleTime: 60 * 1000,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  }
}

export const useVencimientos = (groupId) => {
  const query = useQuery({
    queryKey: ['report', 'vencimientos', groupId],
    queryFn: async () => {
      const response = await api.get(`/groups/${groupId}/reports/vencimientos`)
      return response.data.data
    },
    enabled: !!groupId,
    staleTime: 60 * 1000,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  }
}

export const useMonthlyRecordsForPago = (groupId, { month, year } = {}) => {
  const query = useQuery({
    queryKey: ['monthlyRecords', 'pago', groupId, month, year],
    queryFn: async () => {
      const params = new URLSearchParams({ month, year })
      const response = await api.get(`/groups/${groupId}/monthly-records?${params}`)
      return response.data.data
    },
    enabled: !!groupId && !!month && !!year,
    staleTime: 60 * 1000,
  })

  return {
    records: query.data?.records || [],
    isLoading: query.isLoading,
    error: query.error,
  }
}

export const useReportDownload = (groupId) => {
  const downloadFile = async (url, filename) => {
    try {
      const response = await api.get(url, { responseType: 'blob' })
      const blob = new Blob([response.data], {
        type: response.headers['content-type'],
      })
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(downloadUrl)
      toast.success(`Descargado: ${filename}`)
    } catch (error) {
      toast.error(error.response?.data?.message || 'Error al descargar')
    }
  }

  const downloadPDF = (path, filename) => {
    return downloadFile(`/groups/${groupId}/reports/${path}`, filename)
  }

  const downloadExcel = (path, filename) => {
    return downloadFile(`/groups/${groupId}/reports/${path}`, filename)
  }

  const downloadDOCX = (path, filename) => {
    return downloadFile(`/groups/${groupId}/reports/${path}`, filename)
  }

  const downloadHTML = (path, filename) => {
    return downloadFile(`/groups/${groupId}/reports/${path}`, filename)
  }

  return { downloadPDF, downloadExcel, downloadDOCX, downloadHTML }
}

export const useSendReportEmail = (groupId) => {
  const mutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post(`/groups/${groupId}/reports/send-email`, data)
      return response.data
    },
    onSuccess: () => {
      toast.success('Reporte enviado por email')
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Error al enviar email')
    },
  })

  return {
    send: mutation.mutate,
    isSending: mutation.isPending,
  }
}
