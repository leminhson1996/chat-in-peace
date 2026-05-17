import { useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../../api/client'
import { useChatStore } from '../../store/chatStore'
import type { CryptoReady } from '../../hooks/useCrypto'
import { useAuthStore } from '../../store/authStore'

interface Props {
  onClose: () => void
  crypto: CryptoReady
}

export default function NewRoomModal({ onClose, crypto }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { setRooms, rooms } = useChatStore()
  const username = useAuthStore(s => s.username)!

  async function create() {
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      // Generate room key and wrap for creator
      const wrapped = await crypto.createRoomKeys([])
      const room = await api.createRoom(name.trim(), wrapped[username])
      setRooms([...rooms, { id: room.id, name: room.name, created_by: username, members: [username] }])
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-discord-sidebar rounded-lg w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold text-lg">Create Channel</h2>
          <button onClick={onClose} className="text-discord-muted hover:text-white"><X size={20} /></button>
        </div>
        <label className="block text-discord-muted text-xs font-semibold uppercase mb-1">Channel Name</label>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
          onKeyDown={e => e.key === 'Enter' && create()}
          placeholder="new-channel"
          className="w-full bg-discord-bg text-discord-text px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-discord-accent mb-4"
        />
        {error && <p className="text-discord-red text-sm mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-discord-text hover:underline">Cancel</button>
          <button
            onClick={create}
            disabled={loading || !name.trim()}
            className="px-4 py-2 text-sm bg-discord-accent hover:bg-discord-accent-hover text-white rounded disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating…' : 'Create Channel'}
          </button>
        </div>
      </div>
    </div>
  )
}
