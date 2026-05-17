import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Hash, MessageSquare, Send, Lock, UserPlus, Settings, ArrowLeft } from 'lucide-react'
import { format } from 'date-fns'
import { useChatStore, convKey, type ConversationKey } from '../../store/chatStore'
import { useAuthStore } from '../../store/authStore'
import { api } from '../../api/client'
import type { CryptoReady } from '../../hooks/useCrypto'
import AddMemberModal from './AddMemberModal'
import RoomSettingsModal from './RoomSettingsModal'
import UserAvatar from '../UserAvatar'

interface Props {
  conv: ConversationKey
  onSendRoom: (roomId: string, text: string) => void
  onSendDM: (to: string, text: string) => void
  onJoinRoom: (roomId: string) => void
  onBack?: () => void
  crypto: CryptoReady
}

export default function ChatArea({ conv, onSendRoom, onSendDM, onJoinRoom, onBack, crypto }: Props) {
  const { messages, setMessages, rooms } = useChatStore()
  const myUsername = useAuthStore(s => s.username)
  const key = convKey(conv)
  const msgs = messages[key] ?? []
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const currentRoom = conv.type === 'room' ? rooms.find(r => r.id === conv.id) : null
  const isOwner = currentRoom?.created_by === myUsername

  // Load history + join room on conversation switch
  useEffect(() => {
    if (!crypto.ready) return
    async function load() {
      try {
        let history
        if (conv.type === 'room') {
          history = await api.getRoomHistory(conv.id)
          onJoinRoom(conv.id)
        } else {
          history = await api.getDMHistory(conv.username)
        }
        const decrypted = await Promise.all(
          history.map(async m => {
            const content = conv.type === 'room'
              ? await crypto.decryptRoom(conv.id, m)
              : await crypto.decryptDM(conv.username, m)
            return { id: m.id, sender: m.sender, ts: m.ts, content }
          })
        )
        setMessages(key, decrypted)
      } catch { /* ignore */ }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, crypto.ready])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs.length])

  // Re-pin to the latest message whenever the visual viewport resizes — i.e.
  // when the mobile keyboard opens or closes. Without this the message list
  // keeps its old scrollTop and the user lands on blank space above the input.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setInput('')
    try {
      if (conv.type === 'room') {
        onSendRoom(conv.id, text)
      } else {
        onSendDM(conv.username, text)
      }
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const title = conv.type === 'room' ? conv.name : conv.username
  const placeholder = conv.type === 'room' ? `Message #${title}` : `Message @${title}`

  return (
    <div className="flex flex-col flex-1 bg-discord-channel overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 sm:px-4 h-12 border-b border-black/20 shadow-sm shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="md:hidden text-discord-muted hover:text-white transition-colors -ml-1 p-1"
            title="Back"
            aria-label="Back to conversation list"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        {conv.type === 'room'
          ? <Hash size={20} className="text-discord-muted shrink-0" />
          : <MessageSquare size={20} className="text-discord-muted shrink-0" />
        }
        <span className="font-semibold text-white truncate">{title}</span>
        {conv.type === 'room' && currentRoom && (
          <span className="text-discord-muted text-xs ml-1 hidden sm:inline shrink-0">· {currentRoom.members.length} member{currentRoom.members.length === 1 ? '' : 's'}</span>
        )}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {conv.type === 'room' && (
            <button
              onClick={() => setShowAddMember(true)}
              className="text-discord-muted hover:text-white transition-colors"
              title="Add member"
            >
              <UserPlus size={18} />
            </button>
          )}
          {conv.type === 'room' && isOwner && (
            <button
              onClick={() => setShowSettings(true)}
              className="text-discord-muted hover:text-white transition-colors"
              title="Channel settings"
            >
              <Settings size={18} />
            </button>
          )}
          <div className="flex items-center gap-1 text-discord-green text-xs" title="End-to-end encrypted">
            <Lock size={12} />
            <span className="hidden lg:inline">E2E Encrypted</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-0.5">
        {msgs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-discord-muted">
            <Lock size={40} className="mb-3 opacity-30" />
            <p className="text-sm">Messages are end-to-end encrypted.</p>
            <p className="text-xs mt-1">Be the first to say something!</p>
          </div>
        )}
        {msgs.map((msg, i) => {
          const isMe = msg.sender === myUsername
          const prevMsg = msgs[i - 1]
          const isGrouped = prevMsg && prevMsg.sender === msg.sender && msg.ts - prevMsg.ts < 5 * 60 * 1000
          return (
            <div key={msg.id} className={isGrouped ? 'pl-14' : 'flex gap-3 mt-4'}>
              {!isGrouped && (
                <UserAvatar username={msg.sender} size={40} />
              )}
              <div className="flex-1 min-w-0">
                {!isGrouped && (
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className={`font-medium text-sm ${isMe ? 'text-discord-accent' : 'text-white'}`}>
                      {msg.sender}
                    </span>
                    <span className="text-discord-muted text-xs">
                      {format(msg.ts, 'MMM d, h:mm a')}
                    </span>
                  </div>
                )}
                <p className="text-discord-text text-sm leading-relaxed break-words">{msg.content}</p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 sm:px-4 pb-2 sm:pb-4 pt-1 shrink-0">
        <div className="flex items-end gap-2 bg-[#383a40] rounded-lg px-3 sm:px-4 py-2 sm:py-2.5">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => {
              // Keyboard is about to open on mobile — scroll latest message
              // into view once the viewport has finished resizing.
              setTimeout(() => bottomRef.current?.scrollIntoView({ block: 'end' }), 250)
            }}
            placeholder={placeholder}
            rows={1}
            className="msg-input flex-1 min-h-[24px] max-h-32 py-0.5 bg-transparent placeholder:text-discord-muted"
            style={{ resize: 'none', overflow: 'auto' }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || sending}
            className="text-discord-muted hover:text-discord-accent disabled:opacity-30 transition-colors pb-0.5"
            aria-label="Send"
          >
            <Send size={18} />
          </button>
        </div>
        <p className="hidden sm:block text-discord-muted text-[11px] mt-1.5 px-1">
          Enter to send · Shift+Enter for new line
        </p>
      </div>

      {showAddMember && conv.type === 'room' && currentRoom && (
        <AddMemberModal
          roomId={conv.id}
          currentMembers={currentRoom.members}
          onClose={() => setShowAddMember(false)}
          crypto={crypto}
        />
      )}

      {showSettings && conv.type === 'room' && currentRoom && (
        <RoomSettingsModal
          roomId={conv.id}
          currentName={currentRoom.name}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
