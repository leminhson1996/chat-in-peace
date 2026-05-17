import { useState } from 'react'
import { X, Trash2, Pencil } from 'lucide-react'
import { api } from '../../api/client'
import { useChatStore } from '../../store/chatStore'

interface Props {
  roomId: string
  currentName: string
  onClose: () => void
}

export default function RoomSettingsModal({ roomId, currentName, onClose }: Props) {
  const { rooms, setRooms, setActive, active } = useChatStore()
  const [name, setName] = useState(currentName)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const nameDirty = name.trim() !== '' && name.trim() !== currentName

  async function rename() {
    if (!nameDirty) return
    setBusy(true)
    setError('')
    try {
      const r = await api.renameRoom(roomId, name.trim())
      setRooms(rooms.map(x => x.id === roomId ? { ...x, name: r.name } : x))
      if (active?.type === 'room' && active.id === roomId) {
        setActive({ type: 'room', id: roomId, name: r.name })
      }
      onClose()
    } catch (e: any) {
      setError(e.message ?? 'Failed to rename')
    } finally {
      setBusy(false)
    }
  }

  async function del() {
    setBusy(true)
    setError('')
    try {
      await api.deleteRoom(roomId)
      setRooms(rooms.filter(x => x.id !== roomId))
      if (active?.type === 'room' && active.id === roomId) {
        setActive(null)
      }
      onClose()
    } catch (e: any) {
      setError(e.message ?? 'Failed to delete')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-discord-sidebar rounded-lg w-full max-w-md shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/20">
          <h2 className="text-white font-semibold text-lg">Channel Settings</h2>
          <button onClick={onClose} className="text-discord-muted hover:text-white"><X size={20} /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Rename */}
          <div>
            <label className="flex items-center gap-1.5 text-discord-muted text-xs font-semibold uppercase mb-2">
              <Pencil size={12} /> Channel Name
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              onKeyDown={e => e.key === 'Enter' && rename()}
              className="w-full bg-discord-bg text-discord-text px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-discord-accent"
            />
            <button
              onClick={rename}
              disabled={!nameDirty || busy}
              className="mt-2 px-4 py-2 text-sm bg-discord-accent hover:bg-discord-accent-hover text-white rounded disabled:opacity-50 transition-colors"
            >
              {busy && nameDirty ? 'Saving…' : 'Save Name'}
            </button>
          </div>

          <hr className="border-discord-hover" />

          {/* Delete */}
          <div>
            <label className="flex items-center gap-1.5 text-discord-red text-xs font-semibold uppercase mb-2">
              <Trash2 size={12} /> Danger Zone
            </label>
            <p className="text-discord-muted text-xs mb-3">
              Permanently delete this channel along with all messages and member keys. This cannot be undone.
            </p>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={del}
                  disabled={busy}
                  className="px-4 py-2 text-sm bg-discord-red hover:bg-red-600 text-white rounded disabled:opacity-50 transition-colors"
                >
                  {busy ? 'Deleting…' : `Yes, delete #${currentName}`}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="px-4 py-2 text-sm text-discord-text hover:underline">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="px-4 py-2 text-sm bg-discord-red/20 text-discord-red hover:bg-discord-red/30 rounded transition-colors"
              >
                Delete Channel
              </button>
            )}
          </div>

          {error && <p className="text-discord-red text-sm">{error}</p>}
        </div>
      </div>
    </div>
  )
}
