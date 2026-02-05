// Groups Hook - handles group operations
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { groupsAPI, invitesAPI } from '../services/api'
import { useAuthStore } from '../stores/authStore'

export const useGroups = () => {
  const queryClient = useQueryClient()
  const { addGroup, setGroups, setCurrentGroup, removeInvite } = useAuthStore()

  // Fetch groups
  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: async () => {
      const response = await groupsAPI.list()
      return response.data.data
    },
    onSuccess: (data) => {
      setGroups(data)
    },
  })

  // Create group
  const createGroupMutation = useMutation({
    mutationFn: groupsAPI.create,
    onSuccess: (response) => {
      const group = response.data.data
      addGroup({
        id: group.id,
        name: group.name,
        slug: group.slug,
        role: 'ADMIN',
      })
      queryClient.invalidateQueries(['groups'])
      toast.success('Grupo creado exitosamente')
    },
    onError: (error) => {
      const message = error.response?.data?.message || 'Error al crear grupo'
      toast.error(message)
    },
  })

  // Invite user
  const inviteUserMutation = useMutation({
    mutationFn: ({ groupId, data }) => groupsAPI.invite(groupId, data),
    onSuccess: (response) => {
      const invite = response.data.data
      toast.success(`Invitacion enviada a ${invite.email}`)
      queryClient.invalidateQueries(['group-invites'])
    },
    onError: (error) => {
      const message = error.response?.data?.message || 'Error al enviar invitacion'
      toast.error(message)
    },
  })

  // Accept invite
  const acceptInviteMutation = useMutation({
    mutationFn: invitesAPI.accept,
    onSuccess: (response, token) => {
      const data = response.data.data
      addGroup({
        id: data.groupId,
        name: data.groupName,
        role: data.role,
      })
      // Find and remove the invite from pending list
      const pendingInvites = useAuthStore.getState().pendingInvites
      const acceptedInvite = pendingInvites.find((i) => i.token === token)
      if (acceptedInvite) {
        removeInvite(acceptedInvite.id)
      }
      queryClient.invalidateQueries(['groups'])
      queryClient.invalidateQueries(['me'])
      toast.success(`Te uniste a ${data.groupName}`)
    },
    onError: (error) => {
      const message = error.response?.data?.message || 'Error al aceptar invitacion'
      toast.error(message)
    },
  })

  return {
    groups: groupsQuery.data || [],
    isLoading: groupsQuery.isLoading,
    createGroup: createGroupMutation.mutate,
    inviteUser: inviteUserMutation.mutate,
    acceptInvite: acceptInviteMutation.mutate,
    setCurrentGroup,
    isCreating: createGroupMutation.isPending,
    isInviting: inviteUserMutation.isPending,
    isAccepting: acceptInviteMutation.isPending,
  }
}
