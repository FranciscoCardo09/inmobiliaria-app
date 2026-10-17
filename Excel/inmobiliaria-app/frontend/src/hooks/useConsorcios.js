// useConsorcios — consorcios, rubros, reglas y rendiciones mensuales.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

const errMsg = (e, fallback) => e.response?.data?.message || fallback

// Con responseType 'blob' el error del backend llega como Blob: hay que leerlo
// para mostrar el mensaje real (p. ej. "faltan clasificar 3 movimientos").
async function blobErrorMessage(error) {
  try {
    const text = await error.response.data.text()
    return JSON.parse(text).message
  } catch {
    return null
  }
}

// Mutación con toasts. `onDone(data)` corre antes del toast de éxito.
// `fail === false` deja el manejo del error a la pantalla.
function useApiMutation(fn, { onDone, ok, fail }) {
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      onDone(data)
      if (ok) toast.success(typeof ok === 'function' ? ok(data) : ok)
    },
    onError: (e) => { if (fail !== false) toast.error(errMsg(e, fail || 'Error')) },
  })
}

export const useConsorcios = (groupId) => {
  const qc = useQueryClient()
  const base = `/groups/${groupId}/consorcios`
  const invalidate = () => qc.invalidateQueries({ queryKey: ['consorcios', groupId] })

  const list = useQuery({
    queryKey: ['consorcios', groupId, 'list'],
    queryFn: async () => (await api.get(base)).data.data,
    enabled: !!groupId,
  })

  const create = useMutation({
    mutationFn: async (data) => (await api.post(base, data)).data.data,
    onSuccess: () => { invalidate(); toast.success('Consorcio creado con los rubros por defecto') },
    onError: (e) => toast.error(errMsg(e, 'Error al crear el consorcio')),
  })

  return { consorcios: list.data || [], isLoading: list.isLoading, create }
}

export const useConsorcio = (groupId, consorcioId) => {
  const qc = useQueryClient()
  const base = `/groups/${groupId}/consorcios/${consorcioId}`
  const invalidate = () => qc.invalidateQueries({ queryKey: ['consorcios', groupId] })

  const detail = useQuery({
    queryKey: ['consorcios', groupId, 'detail', consorcioId],
    queryFn: async () => (await api.get(base)).data.data,
    enabled: !!groupId && !!consorcioId,
  })

  const rendiciones = useQuery({
    queryKey: ['consorcios', groupId, 'rendiciones', consorcioId],
    queryFn: async () => (await api.get(`${base}/rendiciones`)).data.data,
    enabled: !!groupId && !!consorcioId,
  })

  const opts = (ok, fail) => ({ onDone: invalidate, ok, fail })
  const update = useApiMutation(async (data) => (await api.put(base, data)).data.data, opts('Consorcio actualizado', 'Error al guardar'))
  const remove = useApiMutation(async () => api.delete(base), opts('Consorcio eliminado', 'No se pudo eliminar'))
  const createRubro = useApiMutation(async (data) => (await api.post(`${base}/rubros`, data)).data.data, opts('Rubro creado', 'Error al crear el rubro'))
  const updateRubro = useApiMutation(async ({ id, ...data }) => (await api.put(`${base}/rubros/${id}`, data)).data.data, opts('Rubro guardado', 'Error al guardar el rubro'))
  const removeRubro = useApiMutation(async (id) => api.delete(`${base}/rubros/${id}`), opts('Rubro eliminado', 'No se pudo eliminar el rubro'))
  const createRegla = useApiMutation(async (data) => (await api.post(`${base}/reglas`, data)).data.data, opts('Regla creada', 'Error al crear la regla'))
  const updateRegla = useApiMutation(async ({ id, ...data }) => (await api.put(`${base}/reglas/${id}`, data)).data.data, opts('Regla guardada', 'Error al guardar la regla'))
  const removeRegla = useApiMutation(async (id) => api.delete(`${base}/reglas/${id}`), opts('Regla eliminada', 'No se pudo eliminar la regla'))
  // El upload maneja sus errores en la pantalla (REQUIRES_REPLACE pide confirmación).
  const upload = useApiMutation(async (data) => (await api.post(`${base}/rendiciones`, data)).data.data, opts(null, false))

  return {
    consorcio: detail.data,
    rendiciones: rendiciones.data || [],
    isLoading: detail.isLoading,
    update, remove, createRubro, updateRubro, removeRubro, createRegla, updateRegla, removeRegla, upload,
  }
}

export const useRendicion = (groupId, rendicionId) => {
  const qc = useQueryClient()
  const base = `/groups/${groupId}/consorcios/rendiciones/${rendicionId}`
  const key = ['consorcios', groupId, 'rendicion', rendicionId]

  const query = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get(base)).data.data,
    enabled: !!groupId && !!rendicionId,
    staleTime: 0,
  })

  // Todas las mutaciones devuelven la rendición completa: se escribe directo en la caché.
  const onDone = (data) => {
    if (data && data.rendicion) qc.setQueryData(key, data)
    qc.invalidateQueries({ queryKey: ['consorcios', groupId, 'rendiciones'] })
    qc.invalidateQueries({ queryKey: ['consorcios', groupId, 'detail'] })
  }
  const opts = (ok, fail) => ({ onDone, ok, fail })
  const data = async (p) => (await p).data.data
  const pendientes = (d) => d.movimientos.filter((m) => m.status === 'PENDIENTE').length

  const classify = useApiMutation((items) => data(api.patch(`${base}/movimientos`, { items })), opts((d) => `Guardado. Quedan ${pendientes(d)} pendientes`, 'Error al clasificar'))
  const reapply = useApiMutation(() => data(api.post(`${base}/reaplicar-reglas`)), opts((d) => `Reglas aplicadas (${d.changed} movimientos revisados)`, 'Error al aplicar reglas'))
  const createAjuste = useApiMutation((body) => data(api.post(`${base}/ajustes`, body)), opts('Ajuste guardado', 'Error al guardar el ajuste'))
  const updateAjuste = useApiMutation(({ id, ...body }) => data(api.put(`${base}/ajustes/${id}`, body)), opts('Ajuste guardado', 'Error al guardar el ajuste'))
  const removeAjuste = useApiMutation((id) => data(api.delete(`${base}/ajustes/${id}`)), opts('Ajuste eliminado', 'Error al eliminar el ajuste'))
  const setReserve = useApiMutation((body) => data(api.put(`${base}/reserva`, body)), opts('Reserva guardada', 'Error al guardar la reserva'))
  const setOrder = useApiMutation((keys) => data(api.put(`${base}/orden`, { keys })), opts(null, 'Error al reordenar'))
  const close = useApiMutation(() => data(api.post(`${base}/cerrar`)), opts('Mes cerrado. Su Total Caja pasa como Reserva del mes siguiente.', 'No se pudo cerrar'))
  const reopen = useApiMutation(() => data(api.post(`${base}/reabrir`)), opts('Rendición reabierta', 'No se pudo reabrir'))
  const remove = useApiMutation(() => api.delete(base), opts('Rendición eliminada', 'No se pudo eliminar'))

  const download = async (format) => {
    try {
      const res = await api.get(`${base}/descargar/${format}`, { responseType: 'blob' })
      const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] || '')?.[1] || `rendicion.${format}`
      const url = window.URL.createObjectURL(new Blob([res.data], { type: res.headers['content-type'] }))
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      toast.success(`Descargado: ${name}`)
    } catch (e) {
      toast.error((await blobErrorMessage(e)) || 'Error al descargar')
    }
  }

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    classify, reapply, createAjuste, updateAjuste, removeAjuste, setReserve, setOrder, close, reopen, remove,
    download,
  }
}
