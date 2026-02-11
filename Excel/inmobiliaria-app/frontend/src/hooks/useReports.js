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
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
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
  })

  return {
    data: query.data,
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

  return { downloadPDF, downloadExcel }
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
