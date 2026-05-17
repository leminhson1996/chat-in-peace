import { useAuthStore } from '../store/authStore'

const BASE = '/api'

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = useAuthStore.getState().token
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; username: string; role: string }>('POST', '/auth/login', { username, password }),

  me: () => request<{ username: string; role: string; has_pubkey: string; icon: string }>('GET', '/auth/me'),

  uploadPubkey: (pubkey: string) => request<void>('POST', '/users/me/pubkey', { pubkey }),
  getPubkey: (username: string) => request<{ pubkey: string }>('GET', `/users/${username}/pubkey`),

  getRooms: () => request<Array<{ id: string; name: string; created_by: string; members: string[] }>>('GET', '/rooms'),
  createRoom: (name: string, wrapped_key: string) =>
    request<{ id: string; name: string }>('POST', '/rooms', { name, wrapped_key }),
  renameRoom: (id: string, name: string) =>
    request<{ id: string; name: string }>('PATCH', `/rooms/${id}`, { name }),
  deleteRoom: (id: string) => request<void>('DELETE', `/rooms/${id}`),
  getRoomKey: (id: string) => request<{ wrapped_key: string }>('GET', `/rooms/${id}/key`),
  getRoomHistory: (id: string) => request<Message[]>('GET', `/rooms/${id}/history`),
  addRoomMember: (id: string, username: string, wrapped_key: string) =>
    request<void>('POST', `/rooms/${id}/members`, { username, wrapped_key }),

  listUsers: () => request<Array<{ username: string; has_pubkey: boolean; icon: string }>>('GET', '/users'),

  getDMHistory: (username: string) => request<Message[]>('GET', `/dm/${username}/history`),

  // Web Push
  getVapidPublic: () => request<{ public_key: string; enabled: boolean }>('GET', '/push/vapid-public'),
  registerPush: (sub: PushSubscriptionJSON) => request<void>('POST', '/users/me/push', sub),
  unregisterPush: (sub: PushSubscriptionJSON) => request<void>('DELETE', '/users/me/push', sub),

  // Admin
  adminListUsers: () => request<Array<{ username: string; role: string; icon: string }>>('GET', '/admin/users'),
  adminSetIcon: (username: string, icon: string) =>
    request<{ username: string; icon: string }>('PATCH', `/admin/users/${username}/icon`, { icon }),
  adminCreateUser: (username: string, password: string, role: string) =>
    request<{ username: string }>('POST', '/admin/users', { username, password, role }),
  adminDeleteUser: (username: string) => request<void>('DELETE', `/admin/users/${username}`),
  adminResetPassword: (username: string, password: string) =>
    request<void>('PATCH', `/admin/users/${username}/password`, { password }),
  adminDeleteRoom: (id: string) => request<void>('DELETE', `/admin/rooms/${id}`),
  adminAddMember: (id: string, username: string, wrapped_key: string) =>
    request<void>('POST', `/admin/rooms/${id}/members`, { username, wrapped_key }),
  adminRemoveMember: (id: string, username: string) =>
    request<void>('DELETE', `/admin/rooms/${id}/members/${username}`),
  adminGetSettings: () => request<{ history_ttl_days: number }>('GET', '/admin/settings'),
  adminUpdateSettings: (history_ttl_days: string) =>
    request<{ history_ttl_days: number }>('PUT', '/admin/settings', { history_ttl_days }),
}

export interface Message {
  id: string
  sender: string
  ts: number
  iv: string
  ct: string
}
