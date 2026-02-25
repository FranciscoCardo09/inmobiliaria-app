import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const usePropertyGroups = (groupId) => {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['propertyGroups', groupId],
    queryFn: async () => {
      const res = await api.get(`/groups/${groupId}/property-groups`)
      return res.data.data
    },
    enabled: !!groupId,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['propertyGroups'] })
  }

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const res = await api.post(`/groups/${groupId}/property-groups`, data)
      return res.data.data
    },
    onSuccess: () => { invalidate(); toast.success('Grupo creado') },
    onError: (e) => toast.error(e.response?.data?.message || 'Error al crear grupo'),
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }) => {
      const res = await api.put(`/groups/${groupId}/property-groups/${id}`, data)
      return res.data.data
    },
    onSuccess: () => { invalidate(); toast.success('Grupo actualizado') },
    onError: (e) => toast.error(e.response?.data?.message || 'Error al actualizar grupo'),
  })

  const removeMutation = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/groups/${groupId}/property-groups/${id}`)
    },
    onSuccess: () => { invalidate(); toast.success('Grupo eliminado') },
    onError: (e) => toast.error(e.response?.data?.message || 'Error al eliminar grupo'),
  })

  return {
    groups: query.data || [],
    isLoading: query.isLoading,
    createGroup: createMutation.mutateAsync,
    updateGroup: updateMutation.mutateAsync,
    removeGroup: removeMutation.mutateAsync,
    isCreating: createMutation.isPending,
  }
}
