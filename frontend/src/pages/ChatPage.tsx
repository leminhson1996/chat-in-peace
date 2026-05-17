import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import { useChatStore } from '../store/chatStore'
import { useAuthStore } from '../store/authStore'
import { useCrypto } from '../hooks/useCrypto'
import { useWebSocket } from '../hooks/useWebSocket'
import Sidebar from '../components/Sidebar/Sidebar'
import ChatArea from '../components/ChatArea/ChatArea'
import NewRoomModal from '../components/ChatArea/NewRoomModal'

export default function ChatPage() {
  const { rooms, setRooms, active, setActive, setUserIcons, setUserColors } = useChatStore()
  const username = useAuthStore(s => s.username)!
  const crypto = useCrypto()
  const { sendRoom, sendDM, joinRoom } = useWebSocket(crypto)
  const [showNewRoom, setShowNewRoom] = useState(false)
  const [dmUsers, setDmUsers] = useState<string[]>([])

  // Load rooms
  useEffect(() => {
    api.getRooms().then(setRooms).catch(() => {})
  }, [setRooms])

  // Build DM user list: everyone on the server who has a pubkey (so we can
  // actually encrypt to them) plus any peer surfaced via shared rooms. Excludes
  // self. Falls back gracefully if /api/users fails.
  useEffect(() => {
    let cancelled = false
    async function load() {
      const seen = new Set<string>()
      try {
        const users = await api.listUsers()
        if (!cancelled) {
          const iconMap: Record<string, string> = {}
          const colorMap: Record<string, string> = {}
          users.forEach(u => {
            if (u.icon) iconMap[u.username] = u.icon
            if (u.color) colorMap[u.username] = u.color
          })
          setUserIcons(iconMap)
          setUserColors(colorMap)
        }
        users.forEach(u => {
          if (u.username !== username && u.has_pubkey) seen.add(u.username)
        })
      } catch { /* ignore — fall back to room-derived peers */ }
      rooms.forEach(r => r.members?.forEach(m => { if (m !== username) seen.add(m) }))
      if (!cancelled) setDmUsers([...seen].sort())
    }
    load()
    return () => { cancelled = true }
  }, [rooms, username])

  // Track the visual viewport so the layout shrinks when the iOS/Android soft
  // keyboard opens — `100dvh` alone doesn't react to the keyboard on iOS Safari,
  // which causes the page to scroll up and hide the chat header + history.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const set = () => {
      document.documentElement.style.setProperty('--app-height', `${vv.height}px`)
    }
    set()
    vv.addEventListener('resize', set)
    vv.addEventListener('scroll', set)
    return () => {
      vv.removeEventListener('resize', set)
      vv.removeEventListener('scroll', set)
    }
  }, [])

  if (!crypto.ready) {
    return (
      <div className="min-h-screen bg-discord-bg flex items-center justify-center flex-col gap-3">
        <Lock size={32} className="text-discord-accent animate-pulse" />
        <p className="text-discord-muted text-sm">Setting up encryption keys…</p>
      </div>
    )
  }

  return (
    // `--app-height` is driven by `window.visualViewport` (see effect above) so
    // the layout shrinks when the mobile keyboard opens. `100dvh` is the
    // fallback for browsers without visualViewport.
    <div className="flex overflow-hidden" style={{ height: 'var(--app-height, 100dvh)' }}>
      {/* On <md, single-pane layout: Sidebar fills the screen when no conversation is open. */}
      <div className={clsx('md:flex', active ? 'hidden md:flex' : 'flex')}>
        <Sidebar
          dmUsers={dmUsers}
          onNewRoom={() => setShowNewRoom(true)}
        />
      </div>

      <main className={clsx('flex-1 overflow-hidden', active ? 'flex' : 'hidden md:flex')}>
        {active ? (
          <ChatArea
            conv={active}
            onSendRoom={sendRoom}
            onSendDM={sendDM}
            onJoinRoom={joinRoom}
            crypto={crypto}
            onBack={() => setActive(null)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center flex-col gap-3 text-discord-muted px-6 text-center">
            <Lock size={48} className="opacity-20" />
            <p className="text-lg font-medium">Select a channel or DM to start chatting</p>
            <p className="text-sm opacity-70">All messages are end-to-end encrypted</p>
          </div>
        )}
      </main>

      {showNewRoom && (
        <NewRoomModal
          onClose={() => setShowNewRoom(false)}
          crypto={crypto}
        />
      )}
    </div>
  )
}
