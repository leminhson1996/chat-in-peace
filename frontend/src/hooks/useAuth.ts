import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { clearCryptoCache } from '../crypto'
import { rebindPushIfSubscribed, releasePushBinding } from '../push'

export function useAuth() {
  const { setAuth, logout: clearAuth } = useAuthStore()
  const navigate = useNavigate()

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.login(username, password)
    // Password is held in memory only (see authStore.partialize) so useCrypto
    // can wrap/unwrap the recovery blob during init.
    setAuth(data.token, data.username, data.role, password)
    // Rebind any persistent browser subscription to this user so the bell
    // stays on across sessions (especially important for Safari PWAs where
    // re-subscribing can re-trigger the permission prompt).
    rebindPushIfSubscribed().catch(() => {})
    return data
  }, [setAuth])

  const logout = useCallback(async () => {
    // Release only the backend mapping — keep the browser's SW subscription
    // so the next user (or this user logging back in) doesn't have to grant
    // notification permission again. rebindPushIfSubscribed() on login
    // re-attaches it to whoever logs in next.
    try { await releasePushBinding() } catch { /* best effort */ }
    clearAuth()
    clearCryptoCache()
    navigate('/login')
  }, [clearAuth, navigate])

  return { login, logout }
}
