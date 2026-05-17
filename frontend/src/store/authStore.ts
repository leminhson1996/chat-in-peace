import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  token: string | null
  username: string | null
  role: string | null
  // Held in memory only (never persisted) to wrap/unwrap the recovery blob.
  // Cleared on logout and lost on tab close, which is the intended lifetime.
  password: string | null
  setAuth: (token: string, username: string, role: string, password: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      username: null,
      role: null,
      password: null,
      setAuth: (token, username, role, password) => set({ token, username, role, password }),
      logout: () => set({ token: null, username: null, role: null, password: null }),
    }),
    {
      name: 'cip-auth',
      // Exclude `password` from localStorage — it lives in memory only.
      partialize: (s) => ({ token: s.token, username: s.username, role: s.role }),
    },
  ),
)
