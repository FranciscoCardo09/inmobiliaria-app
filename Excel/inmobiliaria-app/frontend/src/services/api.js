// API Service - Axios configuration
import axios from 'axios'
import { useAuthStore } from '../stores/authStore'

const API_URL = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor - add auth token
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().accessToken
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor - handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // If 401 and we haven't tried to refresh yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      const refreshToken = useAuthStore.getState().refreshToken

      if (refreshToken) {
        try {
          const response = await axios.post(`${API_URL}/auth/refresh`, {
            refreshToken,
          })

          const { accessToken, refreshToken: newRefreshToken } = response.data.data

          useAuthStore.getState().setTokens(accessToken, newRefreshToken)

          originalRequest.headers.Authorization = `Bearer ${accessToken}`
          return api(originalRequest)
        } catch (refreshError) {
          // Refresh failed - logout user
          useAuthStore.getState().logout()
          window.location.href = '/login'
          return Promise.reject(refreshError)
        }
      }
    }

    return Promise.reject(error)
  }
)

// API methods
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  refresh: (refreshToken) => api.post('/auth/refresh', { refreshToken }),
  me: () => api.get('/auth/me'),
  logout: (refreshToken) => api.post('/auth/logout', { refreshToken }),
}

export const groupsAPI = {
  list: () => api.get('/groups'),
  create: (data) => api.post('/groups', data),
  get: (groupId) => api.get(`/groups/${groupId}`),
  update: (groupId, data) => api.put(`/groups/${groupId}`, data),
  delete: (groupId) => api.delete(`/groups/${groupId}`),

  // Members
  listMembers: (groupId) => api.get(`/groups/${groupId}/members`),
  updateMember: (groupId, userId, data) => api.put(`/groups/${groupId}/members/${userId}`, data),
  removeMember: (groupId, userId) => api.delete(`/groups/${groupId}/members/${userId}`),

  // Invites
  invite: (groupId, data) => api.post(`/groups/${groupId}/invite`, data),
  listInvites: (groupId) => api.get(`/groups/${groupId}/invites`),
  cancelInvite: (groupId, inviteId) => api.delete(`/groups/${groupId}/invites/${inviteId}`),
}

export const invitesAPI = {
  accept: (token) => api.post(`/invites/${token}/accept`),
}

export default api
