// Web Push subscription helpers. Calls into the Notification + PushManager
// APIs and syncs subscription state with the backend.

import { api } from './api/client'

function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const buf = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return buf
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
}

export async function getSubscriptionState(): Promise<'unsupported' | 'denied' | 'unsubscribed' | 'subscribed'> {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return 'unsubscribed'
  const sub = await reg.pushManager.getSubscription()
  return sub ? 'subscribed' : 'unsubscribed'
}

export async function subscribePush(): Promise<void> {
  if (!pushSupported()) throw new Error('Push notifications not supported on this browser')

  const reg = await navigator.serviceWorker.ready
  const { public_key, enabled } = await api.getVapidPublic()
  if (!enabled || !public_key) throw new Error('Push notifications are not configured on this server')

  if (Notification.permission === 'default') {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') throw new Error('Notification permission was not granted')
  } else if (Notification.permission !== 'granted') {
    throw new Error('Notifications are blocked — enable them in browser settings')
  }

  // Reuse an existing subscription if one is already attached to this SW.
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBuffer(public_key),
    })
  }
  await api.registerPush(sub.toJSON())
}

export async function unsubscribePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const json = sub.toJSON()
  try { await api.unregisterPush(json) } catch { /* server may be unreachable; still drop local */ }
  await sub.unsubscribe()
}

// Drop the backend's user→subscription mapping without touching the browser's
// SW subscription. Used on logout so the next user logging in on the same
// browser inherits a clean slate, while the browser sub persists across
// sessions (avoids re-prompting for permission and keeps the bell "on").
export async function releasePushBinding(): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  try { await api.unregisterPush(sub.toJSON()) } catch { /* best effort */ }
}

// On login, if the browser already has a push subscription and notifications
// are still granted, rebind it to the now-authenticated user. Silent no-op
// otherwise. Pairs with releasePushBinding() to preserve subscriptions across
// sessions on the same browser.
export async function rebindPushIfSubscribed(): Promise<void> {
  if (!pushSupported()) return
  if (Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  try { await api.registerPush(sub.toJSON()) } catch { /* best effort */ }
}
