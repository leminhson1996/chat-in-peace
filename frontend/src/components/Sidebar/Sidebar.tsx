import { useEffect, useState } from 'react'
import { Hash, MessageSquare, Lock, Settings, LogOut, Plus, Bell, BellOff } from 'lucide-react'
import { useChatStore, type ConversationKey, convKey } from '../../store/chatStore'
import { useAuthStore } from '../../store/authStore'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import clsx from 'clsx'
import UserAvatar from '../UserAvatar'
import { getSubscriptionState, pushSupported, subscribePush, unsubscribePush } from '../../push'

interface Props {
  dmUsers: string[]
  onNewRoom?: () => void
}

export default function Sidebar({ dmUsers, onNewRoom }: Props) {
  const { rooms, active, setActive, unread } = useChatStore()
  const username = useAuthStore(s => s.username)
  const role = useAuthStore(s => s.role)
  const { logout } = useAuth()
  const navigate = useNavigate()

  const [pushState, setPushState] = useState<'unsupported' | 'denied' | 'unsubscribed' | 'subscribed' | 'busy'>('unsubscribed')
  useEffect(() => {
    if (!pushSupported()) { setPushState('unsupported'); return }
    getSubscriptionState().then(setPushState).catch(() => {})
  }, [])

  async function togglePush() {
    if (pushState === 'unsupported' || pushState === 'busy') return
    if (pushState === 'denied') {
      alert('Notifications are blocked. Enable them in your browser settings, then try again.')
      return
    }
    setPushState('busy')
    try {
      if (pushState === 'subscribed') {
        await unsubscribePush()
        setPushState('unsubscribed')
      } else {
        await subscribePush()
        setPushState('subscribed')
      }
    } catch (err) {
      setPushState(await getSubscriptionState())
      alert((err as Error).message)
    }
  }

  function activate(conv: ConversationKey) {
    setActive(conv)
  }

  return (
    <aside className="flex flex-col w-full md:w-60 h-full bg-discord-sidebar shrink-0 select-none">
      {/* Server header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-black/20 shadow-sm">
        <span className="font-semibold text-white truncate">Chat In Peace</span>
        <Lock size={14} className="text-discord-green shrink-0" aria-label="End-to-end encrypted" />
      </div>

      <div className="flex-1 overflow-y-auto py-2 space-y-4">
        {/* Channels */}
        <section>
          <div className="flex items-center justify-between px-4 mb-1">
            <span className="text-xs font-semibold text-discord-muted uppercase tracking-wide">Channels</span>
            <button
              onClick={onNewRoom}
              className="text-discord-muted hover:text-discord-text transition-colors"
              title="New channel"
            >
              <Plus size={16} />
            </button>
          </div>
          {rooms.map(room => {
            const conv: ConversationKey = { type: 'room', id: room.id, name: room.name }
            const k = convKey(conv)
            const isActive = active && convKey(active) === k
            const count = unread[k] ?? 0
            return (
              <button
                key={room.id}
                onClick={() => activate(conv)}
                className={clsx(
                  'flex items-center gap-1.5 w-full px-4 py-1 rounded mx-1 text-sm transition-colors',
                  isActive
                    ? 'bg-discord-active text-white'
                    : count > 0
                      ? 'text-white font-semibold hover:bg-discord-hover'
                      : 'text-discord-muted hover:bg-discord-hover hover:text-discord-text',
                )}
              >
                <Hash size={16} className="shrink-0" />
                <span className="truncate">{room.name}</span>
                {count > 0 && !isActive && (
                  <span className="ml-auto min-w-[18px] h-[18px] px-1.5 rounded-full bg-discord-red text-white text-[11px] font-bold flex items-center justify-center leading-none">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            )
          })}
        </section>

        {/* DMs */}
        {dmUsers.length > 0 && (
          <section>
            <div className="px-4 mb-1">
              <span className="text-xs font-semibold text-discord-muted uppercase tracking-wide">Direct Messages</span>
            </div>
            {dmUsers.map(user => {
              const conv: ConversationKey = { type: 'dm', username: user }
              const k = convKey(conv)
              const isActive = active && convKey(active) === k
              const count = unread[k] ?? 0
              const showBadge = count > 0 && !isActive
              return (
                <button
                  key={user}
                  onClick={() => activate(conv)}
                  className={clsx(
                    'flex items-center gap-2 w-full px-4 py-1 rounded mx-1 text-sm transition-colors',
                    isActive
                      ? 'bg-discord-active text-white'
                      : showBadge
                        ? 'text-white font-semibold hover:bg-discord-hover'
                        : 'text-discord-muted hover:bg-discord-hover hover:text-discord-text',
                  )}
                >
                  <div className="relative shrink-0">
                    <UserAvatar username={user} size={28} />
                    {showBadge && (
                      <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-discord-red text-white text-[10px] font-bold flex items-center justify-center leading-none ring-2 ring-discord-sidebar">
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </div>
                  <span className="truncate">{user}</span>
                </button>
              )
            })}
          </section>
        )}
      </div>

      {/* User area */}
      <div className="flex items-center gap-2 px-2 py-2 bg-discord-bg border-t border-black/20">
        {username && <UserAvatar username={username} size={32} />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{username}</p>
          <p className="text-xs text-discord-green">● Online</p>
        </div>
        {pushState !== 'unsupported' && (
          <button
            onClick={togglePush}
            disabled={pushState === 'busy'}
            className={clsx(
              'transition-colors p-1 disabled:opacity-50',
              pushState === 'subscribed'
                ? 'text-discord-green hover:text-white'
                : 'text-discord-muted hover:text-discord-text',
            )}
            title={
              pushState === 'subscribed' ? 'Disable push notifications'
              : pushState === 'denied'   ? 'Notifications blocked — enable in browser settings'
              : 'Enable push notifications'
            }
          >
            {pushState === 'subscribed' ? <Bell size={16} /> : <BellOff size={16} />}
          </button>
        )}
        {role === 'admin' && (
          <button
            onClick={() => navigate('/admin')}
            className="text-discord-muted hover:text-discord-text transition-colors p-1"
            title="Admin panel"
          >
            <Settings size={16} />
          </button>
        )}
        <button
          onClick={logout}
          className="text-discord-muted hover:text-discord-red transition-colors p-1"
          title="Log out"
        >
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  )
}
