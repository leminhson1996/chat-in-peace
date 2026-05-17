import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { clearCryptoCache } from '../crypto'

export function useAuth() {
  const { setAuth, logout: clearAuth } = useAuthStore()
  const navigate = useNavigate()

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.login(username, password)
    setAuth(data.token, data.username, data.role)
    return data
  }, [setAuth])

  const logout = useCallback(() => {
    clearAuth()
    clearCryptoCache()
    navigate('/login')
  }, [clearAuth, navigate])

  return { login, logout }
}
