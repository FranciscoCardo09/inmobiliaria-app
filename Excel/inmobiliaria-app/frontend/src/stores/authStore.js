// Auth Store using Zustand
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useAuthStore = create(
  persist(
    (set, get) => ({
      // State
      user: null,
      groups: [],
      pendingInvites: [],
      accessToken: null,
      refreshToken: null,
      currentGroupId: null,
      isAuthenticated: false,
      isLoading: true,

      // Actions
      setUser: (user) => set({ user, isAuthenticated: !!user }),

      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken, isAuthenticated: true }),

      setGroups: (groups) => set({ groups }),

      setPendingInvites: (pendingInvites) => set({ pendingInvites }),

      setCurrentGroup: (groupId) => set({ currentGroupId: groupId }),

      getCurrentGroup: () => {
        const state = get()
        return state.groups.find((g) => g.id === state.currentGroupId)
      },

      login: (data) => {
        set({
          user: data.user,
          groups: data.groups || [],
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          isAuthenticated: true,
          currentGroupId: data.groups?.[0]?.id || null,
        })
      },

      logout: () => {
        set({
          user: null,
          groups: [],
          pendingInvites: [],
          accessToken: null,
          refreshToken: null,
          currentGroupId: null,
          isAuthenticated: false,
        })
      },

      setLoading: (isLoading) => set({ isLoading }),

      addGroup: (group) =>
        set((state) => ({
          groups: [...state.groups, group],
          currentGroupId: state.currentGroupId || group.id,
        })),

      removeInvite: (inviteId) =>
        set((state) => ({
          pendingInvites: state.pendingInvites.filter((i) => i.id !== inviteId),
        })),
    }),
    {
      name: 'inmobiliaria-auth',
      partialize: (state) => ({
        user: state.user,
        groups: state.groups,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        currentGroupId: state.currentGroupId,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
