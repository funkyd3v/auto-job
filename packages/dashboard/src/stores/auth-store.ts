import { create } from 'zustand'
import { api } from '@/api/client'

interface AuthState {
  isAuthenticated: boolean
  email: string | null
  isLoading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  check: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: !!localStorage.getItem('accessToken'),
  email: localStorage.getItem('userEmail'),
  isLoading: false,
  error: null,
  check() {
    set({ isAuthenticated: !!localStorage.getItem('accessToken'), email: localStorage.getItem('userEmail') })
  },
  async login(email, password) {
    set({ isLoading: true, error: null })
    try {
      const res = await api.login(email, password)
      localStorage.setItem('accessToken', res.accessToken)
      localStorage.setItem('userEmail', email)
      set({ isAuthenticated: true, email, isLoading: false })
    } catch (e: any) {
      set({ error: e.message || 'Login failed', isLoading: false })
      throw e
    }
  },
  async logout() {
    try { await api.logout() } catch {}
    localStorage.removeItem('accessToken')
    localStorage.removeItem('userEmail')
    set({ isAuthenticated: false, email: null })
  },
}))
