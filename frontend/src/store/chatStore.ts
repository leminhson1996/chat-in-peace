import { create } from 'zustand'

export interface DecryptedMessage {
  id: string
  sender: string
  ts: number
  content: string // plaintext after decryption
}

export type ConversationKey =
  | { type: 'room'; id: string; name: string }
  | { type: 'dm'; username: string }

export interface Room {
  id: string
  name: string
  created_by: string
  members: string[]
}

interface ChatState {
  rooms: Room[]
  messages: Record<string, DecryptedMessage[]> // key = roomId or "dm:username"
  unread: Record<string, number>
  userIcons: Record<string, string> // username → lucide icon id (whitelist in src/icons.tsx)
  active: ConversationKey | null
  setRooms: (rooms: Room[]) => void
  setActive: (conv: ConversationKey | null) => void
  // bumpUnread defaults to true. Callers pass false when the message is the
  // sender's own echo (no notification owed) or already-read history.
  appendMessage: (key: string, msg: DecryptedMessage, bumpUnread?: boolean) => void
  setMessages: (key: string, msgs: DecryptedMessage[]) => void
  setUserIcons: (icons: Record<string, string>) => void
  setUserIcon: (username: string, icon: string) => void
}

export function convKey(conv: ConversationKey) {
  return conv.type === 'room' ? `room:${conv.id}` : `dm:${conv.username}`
}

export const useChatStore = create<ChatState>((set) => ({
  rooms: [],
  messages: {},
  unread: {},
  userIcons: {},
  active: null,
  setRooms: (rooms) => set({ rooms }),
  setActive: (active) =>
    set((s) => {
      if (!active) return { active }
      const k = convKey(active)
      if (!s.unread[k]) return { active }
      const { [k]: _, ...rest } = s.unread
      return { active, unread: rest }
    }),
  appendMessage: (key, msg, bumpUnread = true) =>
    set((s) => {
      const messages = { ...s.messages, [key]: [...(s.messages[key] ?? []), msg] }
      const isActive = s.active != null && convKey(s.active) === key
      if (!bumpUnread || isActive) return { messages }
      return { messages, unread: { ...s.unread, [key]: (s.unread[key] ?? 0) + 1 } }
    }),
  setMessages: (key, msgs) =>
    set((s) => ({ messages: { ...s.messages, [key]: msgs } })),
  setUserIcons: (icons) => set({ userIcons: icons }),
  setUserIcon: (username, icon) =>
    set((s) => {
      if (!icon) {
        const { [username]: _, ...rest } = s.userIcons
        return { userIcons: rest }
      }
      return { userIcons: { ...s.userIcons, [username]: icon } }
    }),
}))
