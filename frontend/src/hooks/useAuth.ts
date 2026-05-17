import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { clearCryptoCache } from '../crypto'
import { unsubscribePush } from '../push'

export function useAuth() {
  const { setAuth, logout: clearAuth } = useAuthStore()
  const navigate = useNavigate()

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.login(username, password)
    setAuth(data.token, data.username, data.role)
    return data
  }, [setAuth])

  const logout = useCallback(async () => {
    // Drop the browser's SW push subscription too. Otherwise, when another
    // user logs in on the same browser, the existing subscription would
    // make the bell look "enabled" but stay registered under the previous
    // user — pushes would still route to whoever subscribed first.
    try { await unsubscribePush() } catch { /* best effort */ }
    clearAuth()
    clearCryptoCache()
    navigate('/login')
  }, [clearAuth, navigate])

  return { login, logout }
}
