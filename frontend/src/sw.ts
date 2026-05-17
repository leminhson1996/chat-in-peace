/// <reference lib="webworker" />
// Custom service worker. Compiled by vite-plugin-pwa (injectManifest mode).
// Handles offline precaching + Web Push.

import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

precacheAndRoute(self.__WB_MANIFEST)

// Take control of pages on activate so newly opened tabs immediately receive
// pushes routed through this SW.
self.addEventListener('install', () => {
  void self.skipWaiting()
})
self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim())
})

interface PushPayload {
  title?: string
  body?: string
  tag?: string
  url?: string
}

self.addEventListener('push', (event) => {
  let data: PushPayload = {}
  if (event.data) {
    try { data = event.data.json() } catch { data = { body: event.data.text() } }
  }
  const title = data.title || 'Chat In Peace'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || 'New activity',
      tag: data.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Focus an existing tab if one is open on our origin.
    for (const client of all) {
      if ('focus' in client) {
        await (client as WindowClient).focus()
        return
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl)
    }
  })())
})
