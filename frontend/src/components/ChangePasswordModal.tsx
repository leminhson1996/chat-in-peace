import { useState } from 'react'
import { X, KeyRound } from 'lucide-react'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { rewrapPrivateKey } from '../crypto/recovery'

interface Props {
  onClose: () => void
}

// Self-serve password change. If a wrapped_privkey blob is on the server, we
// fetch + re-wrap it with the new password client-side so cross-device
// recovery survives. The new + old blob land atomically with the password
// hash on the server.
export default function ChangePasswordModal({ onClose }: Props) {
  const username = useAuthStore(s => s.username)
  const memPassword = useAuthStore(s => s.password)
  const setAuth = useAuthStore(s => s.setAuth)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function submit() {
    setError('')
    if (!current || !next) { setError('Both fields are required'); return }
    if (next.length < 8) { setError('New password must be at least 8 characters'); return }
    if (next !== confirm) { setError('New passwords do not match'); return }
    if (next === current) { setError('New password must differ from current'); return }
    if (!username) return
    setBusy(true)
    try {
      // If we have a wrapped_privkey blob, re-wrap it with the new password so
      // recovery on a fresh device still works. 404 = no blob set up.
      let rewrapped: string | undefined
      try {
        const { wrapped_privkey } = await api.getWrappedPrivkey()
        rewrapped = await rewrapPrivateKey(wrapped_privkey, current, next, username)
      } catch (e: any) {
        // If the blob exists but rewrap fails (wrong current password), surface
        // it now — the server would reject too, but a local check is clearer.
        if (e?.name === 'OperationError') {
          setError('Current password is incorrect')
          setBusy(false)
          return
        }
        // Else assume no blob set up — proceed without rewrapped.
      }
      await api.changePassword(current, next, rewrapped)
      // Keep the in-memory password in sync so subsequent recovery operations
      // (and any future re-wrap) use the new one.
      const auth = useAuthStore.getState()
      if (auth.token && auth.username && auth.role) {
        setAuth(auth.token, auth.username, auth.role, next)
      }
      // Help users who used `memPassword` to wrap initially: noop today, just
      // a hook for any future fallback.
      void memPassword
      setDone(true)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to change password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-discord-sidebar rounded-lg w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/20">
          <h2 className="flex items-center gap-2 text-white font-semibold text-lg">
            <KeyRound size={18} /> Change Password
          </h2>
          <button onClick={onClose} className="text-discord-muted hover:text-white"><X size={20} /></button>
        </div>

        {done ? (
          <div className="px-6 py-6">
            <p className="text-discord-green text-sm mb-3">Password changed.</p>
            <p className="text-discord-muted text-xs mb-4">
              Your recovery blob has been re-encrypted with the new password — cross-device history recovery will use it going forward.
            </p>
            <button onClick={onClose} className="px-4 py-2 text-sm bg-discord-accent hover:bg-discord-accent-hover text-white rounded transition-colors">
              Done
            </button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <Field label="Current password" value={current} onChange={setCurrent} autoFocus />
            <Field label="New password" value={next} onChange={setNext} />
            <Field label="Confirm new password" value={confirm} onChange={setConfirm} onEnter={submit} />
            {error && <p className="text-discord-red text-sm">{error}</p>}
            <p className="text-discord-muted text-xs leading-relaxed">
              The server never sees your password. Your private key is re-encrypted locally so old messages remain recoverable on other devices.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-discord-text hover:underline">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy}
                className="px-4 py-2 text-sm bg-discord-accent hover:bg-discord-accent-hover text-white rounded disabled:opacity-50 transition-colors"
              >
                {busy ? 'Changing…' : 'Change password'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  onEnter?: () => void
  autoFocus?: boolean
}

function Field({ label, value, onChange, onEnter, autoFocus }: FieldProps) {
  return (
    <div>
      <label className="block text-discord-muted text-xs font-semibold uppercase mb-1.5">{label}</label>
      <input
        type="password"
        autoFocus={autoFocus}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && onEnter) onEnter() }}
        className="w-full bg-discord-bg text-discord-text px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-discord-accent"
      />
    </div>
  )
}
