import { useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'
import type { CryptoReady } from './useCrypto'
import type { Message } from '../api/client'

interface WSMessage {
  event: 'message' | 'dm' | 'error'
  room_id?: string
  from?: string
  msg?: Message
  error?: string
}

export function useWebSocket(crypto: CryptoReady) {
  const token = useAuthStore(s => s.token)
  const myUsername = useAuthStore(s => s.username)
  const { appendMessage } = useChatStore()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCount = useRef(0)

  const connect = useCallback(() => {
    if (!token || !crypto.ready) return
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${token}`)
    wsRef.current = ws

    ws.onopen = () => { retryCount.current = 0 }

    ws.onmessage = async (e) => {
      const data: WSMessage = JSON.parse(e.data)
      if (data.event === 'message' && data.msg && data.room_id) {
        try {
          const content = await crypto.decryptRoom(data.room_id, data.msg)
          const isOwn = data.msg.sender === myUsername
          appendMessage(`room:${data.room_id}`, {
            id: data.msg.id,
            sender: data.msg.sender,
            ts: data.msg.ts,
            content,
          }, !isOwn)
        } catch { /* key not loaded yet */ }
      } else if (data.event === 'dm' && data.msg && data.from) {
        // Server sets `from` to the peer (the *other* party) on both sides.
        const peer = data.from
        try {
          const content = await crypto.decryptDM(peer, data.msg)
          const isOwn = data.msg.sender === myUsername
          appendMessage(`dm:${peer}`, {
            id: data.msg.id,
            sender: data.msg.sender,
            ts: data.msg.ts,
            content,
          }, !isOwn)
        } catch { /* key not loaded yet */ }
      }
    }

    ws.onclose = () => {
      if (!token) return // deliberate logout
      const delay = Math.min(1000 * 2 ** retryCount.current, 30000)
      retryCount.current++
      reconnectTimer.current = setTimeout(connect, delay)
    }
  }, [token, crypto.ready]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [connect])

  const sendRoom = useCallback(async (roomId: string, text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    const { iv, ct } = await crypto.encryptForRoom(roomId, text)
    wsRef.current.send(JSON.stringify({ action: 'send_room', room_id: roomId, iv, ct }))
  }, [crypto])

  const sendDM = useCallback(async (to: string, text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    const { iv, ct } = await crypto.encryptForDM(to, text)
    wsRef.current.send(JSON.stringify({ action: 'send_dm', to, iv, ct }))
  }, [crypto])

  const joinRoom = useCallback((roomId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({ action: 'join_room', room_id: roomId }))
  }, [])

  return { sendRoom, sendDM, joinRoom }
}
