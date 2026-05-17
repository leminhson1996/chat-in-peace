import { useEffect, useState } from 'react'
import { X, UserPlus, AlertCircle } from 'lucide-react'
import { api } from '../../api/client'
import { useChatStore } from '../../store/chatStore'
import { useAuthStore } from '../../store/authStore'
import type { CryptoReady } from '../../hooks/useCrypto'

interface Props {
  roomId: string
  currentMembers: string[]
  onClose: () => void
  crypto: CryptoReady
}

interface UserOption {
  username: string
  has_pubkey: boolean
}

export default function AddMemberModal({ roomId, currentMembers, onClose, crypto }: Props) {
  const [allUsers, setAllUsers] = useState<UserOption[]>([])
  const [selected, setSelected] = useState<string>('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { rooms, setRooms } = useChatStore()
  const myUsername = useAuthStore(s => s.username)

  useEffect(() => {
    api.listUsers().then(setAllUsers).catch(() => {})
  }, [])

  // Exclude current members and self
  const candidates = allUsers.filter(u => !currentMembers.includes(u.username) && u.username !== myUsername)
  const eligible = candidates.filter(u => u.has_pubkey)
  const pending  = candidates.filter(u => !u.has_pubkey)

  async function add() {
    if (!selected) return
    setLoading(true)
    setError('')
    try {
      const wrapped = await crypto.wrapRoomKeyForUser(roomId, selected)
      await api.addRoomMember(roomId, selected, wrapped)
      setRooms(rooms.map(r =>
        r.id === roomId ? { ...r, members: [...r.members, selected] } : r,
      ))
      onClose()
    } catch (e: any) {
      setError(e.message ?? 'Failed to add member')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-discord-sidebar rounded-lg w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold text-lg flex items-center gap-2">
            <UserPlus size={18} /> Add Member
          </h2>
          <button onClick={onClose} className="text-discord-muted hover:text-white"><X size={20} /></button>
        </div>

        {candidates.length === 0 ? (
          <p className="text-discord-muted text-sm py-4">No other users available to add.</p>
        ) : (
          <>
            <p className="text-discord-muted text-xs mb-3">
              The room's encryption key will be re-wrapped with the new member's public key, granting them access to all current and future messages.
            </p>

            {eligible.length > 0 ? (
              <>
                <label className="block text-discord-muted text-xs font-semibold uppercase mb-1">Select User</label>
                <select
                  value={selected}
                  onChange={e => setSelected(e.target.value)}
                  className="w-full bg-discord-bg text-discord-text px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-discord-accent mb-3"
                >
                  <option value="">— Choose a user —</option>
                  {eligible.map(u => (
                    <option key={u.username} value={u.username}>{u.username}</option>
                  ))}
                </select>
              </>
            ) : (
              <div className="bg-discord-bg rounded p-3 mb-3 text-discord-muted text-sm">
                No users are ready to be added. New users must log in at least once before they can be added to encrypted channels.
              </div>
            )}

            {pending.length > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3 mb-3">
                <div className="flex items-start gap-2">
                  <AlertCircle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                  <div className="text-xs text-amber-200/80">
                    <p className="font-medium mb-1">Waiting to register encryption keys:</p>
                    <p>{pending.map(u => u.username).join(', ')}</p>
                    <p className="mt-1 opacity-80">These users haven't logged in yet — ask them to sign in once, then refresh to add them.</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {error && <p className="text-discord-red text-sm mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-discord-text hover:underline">Cancel</button>
          <button
            onClick={add}
            disabled={loading || !selected}
            className="px-4 py-2 text-sm bg-discord-accent hover:bg-discord-accent-hover text-white rounded disabled:opacity-50 transition-colors"
          >
            {loading ? 'Adding…' : 'Add Member'}
          </button>
        </div>
      </div>
    </div>
  )
}
