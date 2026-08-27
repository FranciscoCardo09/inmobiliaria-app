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
    // staleTime 0: la liquidación es un derivado de records/servicios/pagos y
    // tiene que reflejar el estado actual, no una foto de hace 10 minutos.
    // La invalidación global por mutación vive en main.jsx (mutationCache).
    staleTime: 0,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

// Codifica overrides de período por contrato a "contractId:mes-anio;..." para el query param.
const encodePeriodOverrides = (overrides) => {
  if (!overrides) return ''
  return Object.entries(overrides)
    .filter(([, o]) => o && o.month && o.year)
    .map(([cid, o]) => `${cid}:${o.month}-${o.year}`)
    .join(';')
}

export const useLiquidacionAll = (groupId, { month, year, propertyIds, honorariosPercent, ownerId, contractIds, soloConPago, periodOverrides } = {}) => {
  const overridesParam = encodePeriodOverrides(periodOverrides)
  const query = useQuery({
    queryKey: ['report', 'liquidacion-all', groupId, month, year, propertyIds, honorariosPercent, ownerId, contractIds, soloConPago, overridesParam],
    queryFn: async () => {
      const params = new URLSearchParams({ month, year })
      if (contractIds && contractIds.length > 0) {
        params.append('contractIds', contractIds.join(','))
      } else if (propertyIds && propertyIds.length > 0) {
        params.append('propertyIds', propertyIds.join(','))
      }
      if (honorariosPercent) {
        params.append('honorariosPercent', honorariosPercent)
      }
      if (ownerId) {
        params.append('ownerId', ownerId)
      }
      if (soloConPago !== undefined) {
        params.append('soloConPago', soloConPago)
      }
      if (overridesParam) {
        params.append('periodOverrides', overridesParam)
      }
      const response = await api.get(`/groups/${groupId}/reports/liquidacion-all?${params}`)
      return response.data.data
    },
    enabled: !!groupId && !!month && !!year,
    // Ver el comentario de useLiquidacion: sin staleTime 0, cambiar un servicio y
    // volver al reporte dentro de la ventana servía el resultado cacheado y hacía
    // parecer que el cálculo no había cambiado (caso Godoy 2026-08-25).
    staleTime: 0,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    // Expuestos para que la pantalla pueda forzar el refresco y, sobre todo,
    // mostrar DE CUÁNDO son los números que está viendo el usuario.
    refetch: query.refetch,
    isFetching: query.isFetching,
    dataUpdatedAt: query.dataUpdatedAt,
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
    staleTime: 10 * 60 * 1000,
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
    staleTime: 10 * 60 * 1000,
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
    staleTime: 10 * 60 * 1000,
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
    staleTime: 10 * 60 * 1000,
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
    staleTime: 10 * 60 * 1000,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  }
}

export const useImpuestos = (groupId, { month, year, propertyIds, ownerId, contractIds } = {}) => {
  const query = useQuery({
    queryKey: ['report', 'impuestos', groupId, month, year, propertyIds, ownerId, contractIds],
    queryFn: async () => {
      const params = new URLSearchParams({ month, year })
      if (contractIds && contractIds.length > 0) {
        params.append('contractIds', contractIds.join(','))
      } else if (propertyIds && propertyIds.length > 0) {
        params.append('propertyIds', propertyIds.join(','))
      }
      if (ownerId) {
        params.append('ownerId', ownerId)
      }
      const response = await api.get(`/groups/${groupId}/reports/impuestos?${params}`)
      return response.data.data
    },
    enabled: !!groupId && !!month && !!year,
    staleTime: 10 * 60 * 1000,
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
    staleTime: 10 * 60 * 1000,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  }
}

export const useMonthlyRecordsForPago = (groupId, { month, year } = {}) => {
  const query = useQuery({
    // groupId en el indice 1 como TODAS las demas keys de la app: con `'pago'` ahi,
    // `invalidateQueries(['monthlyRecords', groupId])` no la matcheaba y esta pantalla
    // quedaba con datos viejos hasta 10 minutos despues de tocar un servicio.
    queryKey: ['monthlyRecords', groupId, 'pago', month, year],
    queryFn: async () => {
      const params = new URLSearchParams({ month, year })
      const response = await api.get(`/groups/${groupId}/monthly-records?${params}`)
      return response.data.data
    },
    enabled: !!groupId && !!month && !!year,
    staleTime: 30 * 1000, // pantalla de cobro: no puede mostrar plata de hace 10 minutos
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

  const downloadFilePost = async (path, body, filename) => {
    try {
      const response = await api.post(`/groups/${groupId}/reports/${path}`, body, { responseType: 'blob' })
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

  const downloadPDFPost = (path, body, filename) => downloadFilePost(path, body, filename)
  const downloadDOCXPost = (path, body, filename) => downloadFilePost(path, body, filename)
  const downloadHTMLPost = (path, body, filename) => downloadFilePost(path, body, filename)
  const downloadExcelPost = (path, body, filename) => downloadFilePost(path, body, filename)

  return { downloadPDF, downloadExcel, downloadDOCX, downloadHTML, downloadPDFPost, downloadDOCXPost, downloadHTMLPost, downloadExcelPost }
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
