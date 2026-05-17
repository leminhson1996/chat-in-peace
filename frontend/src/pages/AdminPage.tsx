import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Trash2, KeyRound, UserPlus, Clock, ImagePlus, X, Check } from 'lucide-react'
import { api } from '../api/client'
import UserAvatar from '../components/UserAvatar'
import { ICONS } from '../icons'
import { COLORS } from '../colors'
import { useChatStore } from '../store/chatStore'

type Tab = 'users' | 'settings'

interface User { username: string; role: string; icon: string; color: string }

const TTL_OPTIONS = [
  { label: 'Never', value: '0' },
  { label: '1 day', value: '1' },
  { label: '7 days', value: '7' },
  { label: '30 days', value: '30' },
  { label: '90 days', value: '90' },
]

export default function AdminPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<User[]>([])
  const [ttl, setTtl] = useState('0')
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' })
  const [resetTarget, setResetTarget] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [iconTarget, setIconTarget] = useState<User | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const setUserIcons = useChatStore(s => s.setUserIcons)
  const setUserIcon = useChatStore(s => s.setUserIcon)
  const setUserColors = useChatStore(s => s.setUserColors)
  const setUserColor = useChatStore(s => s.setUserColor)

  // Mirror loaded user icon/color into chatStore so other surfaces (sidebar,
  // messages) pick them up when the admin lands on this page first.
  useEffect(() => {
    if (users.length === 0) return
    const iconMap: Record<string, string> = {}
    const colorMap: Record<string, string> = {}
    users.forEach(u => {
      if (u.icon) iconMap[u.username] = u.icon
      if (u.color) colorMap[u.username] = u.color
    })
    setUserIcons(iconMap)
    setUserColors(colorMap)
  }, [users, setUserIcons, setUserColors])

  async function chooseIcon(username: string, icon: string) {
    try {
      await api.adminSetIcon(username, icon)
      setUsers(us => us.map(u => u.username === username ? { ...u, icon } : u))
      setUserIcon(username, icon)
      setIconTarget(t => t && t.username === username ? { ...t, icon } : t)
      notify(icon ? 'Icon updated.' : 'Icon cleared.')
    } catch (e: any) { setError(e.message) }
  }

  async function chooseColor(username: string, color: string) {
    try {
      await api.adminSetColor(username, color)
      setUsers(us => us.map(u => u.username === username ? { ...u, color } : u))
      setUserColor(username, color)
      setIconTarget(t => t && t.username === username ? { ...t, color } : t)
      notify(color ? 'Color updated.' : 'Color cleared.')
    } catch (e: any) { setError(e.message) }
  }

  useEffect(() => {
    api.adminListUsers().then(setUsers).catch(() => {})
    api.adminGetSettings().then(d => setTtl(String(d.history_ttl_days))).catch(() => {})
  }, [])

  function notify(msg: string) {
    setSuccess(msg)
    setTimeout(() => setSuccess(''), 3000)
  }

  async function createUser() {
    setError('')
    if (!newUser.username || !newUser.password) { setError('Username and password required'); return }
    try {
      await api.adminCreateUser(newUser.username, newUser.password, newUser.role)
      const updated = await api.adminListUsers()
      setUsers(updated)
      setNewUser({ username: '', password: '', role: 'user' })
      notify(`User "${newUser.username}" created.`)
    } catch (e: any) { setError(e.message) }
  }

  async function deleteUser(username: string) {
    if (!confirm(`Delete user "${username}"?`)) return
    await api.adminDeleteUser(username)
    setUsers(u => u.filter(x => x.username !== username))
    notify(`User "${username}" deleted.`)
  }

  async function resetPw() {
    if (!resetTarget || !resetPassword) return
    try {
      await api.adminResetPassword(resetTarget, resetPassword)
      setResetTarget(null)
      setResetPassword('')
      notify('Password reset.')
    } catch (e: any) { setError(e.message) }
  }

  async function saveTTL(val: string) {
    setTtl(val)
    await api.adminUpdateSettings(val)
    notify('History TTL updated.')
  }

  return (
    <div className="min-h-screen bg-discord-bg text-discord-text">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <button onClick={() => navigate('/')} className="flex items-center gap-1 text-discord-muted hover:text-white mb-6 text-sm">
          <ArrowLeft size={16} /> Back to chat
        </button>

        <h1 className="text-2xl font-bold text-white mb-6">Admin Panel</h1>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-discord-hover pb-0">
          {(['users', 'settings'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
                tab === t ? 'border-discord-accent text-white' : 'border-transparent text-discord-muted hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {success && <div className="mb-4 px-3 py-2 bg-discord-green/20 text-discord-green rounded text-sm">{success}</div>}
        {error && <div className="mb-4 px-3 py-2 bg-discord-red/20 text-discord-red rounded text-sm">{error}</div>}

        {/* Users tab */}
        {tab === 'users' && (
          <div className="space-y-6">
            {/* Create user form */}
            <div className="bg-discord-sidebar rounded-lg p-4">
              <h2 className="text-white font-semibold mb-3 flex items-center gap-2"><UserPlus size={16} /> Add User</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                <input
                  value={newUser.username}
                  onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))}
                  placeholder="Username"
                  className="bg-discord-bg px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-discord-accent"
                />
                <input
                  type="password"
                  value={newUser.password}
                  onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))}
                  placeholder="Password"
                  className="bg-discord-bg px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-discord-accent"
                />
                <select
                  value={newUser.role}
                  onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))}
                  className="bg-discord-bg px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-discord-accent"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button
                onClick={createUser}
                className="px-4 py-2 bg-discord-accent hover:bg-discord-accent-hover text-white rounded text-sm transition-colors"
              >
                Create User
              </button>
            </div>

            {/* User list */}
            <div className="bg-discord-sidebar rounded-lg overflow-x-auto">
              <table className="w-full text-sm min-w-[400px]">
                <thead className="border-b border-discord-hover">
                  <tr>
                    <th className="text-left text-discord-muted px-4 py-3 font-medium w-12" />
                    <th className="text-left text-discord-muted px-4 py-3 font-medium">Username</th>
                    <th className="text-left text-discord-muted px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-discord-hover">
                  {users.map(u => (
                    <tr key={u.username} className="hover:bg-discord-hover/50 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setIconTarget(u)}
                          className="group relative"
                          title="Customize avatar"
                        >
                          <UserAvatar
                            username={u.username}
                            iconOverride={u.icon || null}
                            colorOverride={u.color || null}
                            size={32}
                          />
                          <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <ImagePlus size={14} className="text-white" />
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-white font-medium">{u.username}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${u.role === 'admin' ? 'bg-discord-accent/20 text-discord-accent' : 'bg-discord-muted/20 text-discord-muted'}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setResetTarget(u.username); setResetPassword('') }}
                          className="text-discord-muted hover:text-white transition-colors"
                          title="Reset password"
                        >
                          <KeyRound size={15} />
                        </button>
                        <button
                          onClick={() => deleteUser(u.username)}
                          className="text-discord-muted hover:text-discord-red transition-colors"
                          title="Delete user"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Avatar picker modal — icon + color */}
            {iconTarget && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                <div className="bg-discord-sidebar rounded-lg w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-black/20">
                    <div className="flex items-center gap-3 min-w-0">
                      <UserAvatar
                        username={iconTarget.username}
                        iconOverride={iconTarget.icon || null}
                        colorOverride={iconTarget.color || null}
                        size={36}
                      />
                      <h2 className="text-white font-semibold truncate">
                        Customize avatar — <span className="text-discord-accent">{iconTarget.username}</span>
                      </h2>
                    </div>
                    <button onClick={() => setIconTarget(null)} className="text-discord-muted hover:text-white shrink-0" aria-label="Close">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="overflow-y-auto p-4 space-y-5">
                    {/* Icon */}
                    <div>
                      <h3 className="text-xs font-semibold text-discord-muted uppercase tracking-wide mb-2">Icon</h3>
                      <button
                        onClick={() => chooseIcon(iconTarget.username, '')}
                        className={`w-full mb-2 px-3 py-2 text-sm rounded transition-colors ${
                          !iconTarget.icon
                            ? 'bg-discord-accent text-white'
                            : 'bg-discord-hover text-discord-text hover:bg-discord-active'
                        }`}
                      >
                        No icon (use first letter of username)
                      </button>
                      <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                        {ICONS.map(({ id, label, Component }) => {
                          const selected = iconTarget.icon === id
                          return (
                            <button
                              key={id}
                              onClick={() => chooseIcon(iconTarget.username, id)}
                              title={label}
                              className={`aspect-square rounded flex items-center justify-center transition-colors ${
                                selected
                                  ? 'bg-discord-accent text-white ring-2 ring-white/30'
                                  : 'bg-discord-hover text-discord-text hover:bg-discord-active hover:text-white'
                              }`}
                            >
                              <Component size={20} />
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Color */}
                    <div>
                      <h3 className="text-xs font-semibold text-discord-muted uppercase tracking-wide mb-2">Color</h3>
                      <button
                        onClick={() => chooseColor(iconTarget.username, '')}
                        className={`w-full mb-2 px-3 py-2 text-sm rounded transition-colors ${
                          !iconTarget.color
                            ? 'bg-discord-accent text-white'
                            : 'bg-discord-hover text-discord-text hover:bg-discord-active'
                        }`}
                      >
                        Default
                      </button>
                      <div className="grid grid-cols-8 sm:grid-cols-10 gap-2">
                        {COLORS.map(({ id, label, hex }) => {
                          const selected = iconTarget.color === id
                          return (
                            <button
                              key={id}
                              onClick={() => chooseColor(iconTarget.username, id)}
                              title={label}
                              className={`aspect-square rounded-full flex items-center justify-center transition-transform hover:scale-110 ${
                                selected ? 'ring-2 ring-white ring-offset-2 ring-offset-discord-sidebar' : ''
                              }`}
                              style={{ backgroundColor: hex }}
                              aria-label={label}
                              aria-pressed={selected}
                            >
                              {selected && <Check size={14} className="text-white drop-shadow" />}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Reset password modal */}
            {resetTarget && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                <div className="bg-discord-sidebar rounded-lg p-6 w-full max-w-sm shadow-2xl">
                  <h2 className="text-white font-semibold mb-4">Reset password for <span className="text-discord-accent">{resetTarget}</span></h2>
                  <input
                    autoFocus
                    type="password"
                    value={resetPassword}
                    onChange={e => setResetPassword(e.target.value)}
                    placeholder="New password"
                    className="w-full bg-discord-bg px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-discord-accent mb-4"
                    onKeyDown={e => e.key === 'Enter' && resetPw()}
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setResetTarget(null)} className="px-4 py-2 text-sm text-discord-text hover:underline">Cancel</button>
                    <button onClick={resetPw} className="px-4 py-2 text-sm bg-discord-accent hover:bg-discord-accent-hover text-white rounded transition-colors">
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Settings tab */}
        {tab === 'settings' && (
          <div className="bg-discord-sidebar rounded-lg p-6 space-y-4">
            <h2 className="text-white font-semibold flex items-center gap-2"><Clock size={16} /> Message History TTL</h2>
            <p className="text-discord-muted text-sm">Messages older than this are automatically deleted. Takes effect on the next message sent to each channel.</p>
            <div className="flex flex-wrap gap-2">
              {TTL_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => saveTTL(opt.value)}
                  className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                    ttl === opt.value
                      ? 'bg-discord-accent text-white'
                      : 'bg-discord-hover text-discord-text hover:bg-discord-active'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-discord-muted text-xs">
              Current setting: <span className="text-white">{TTL_OPTIONS.find(o => o.value === ttl)?.label ?? ttl + ' days'}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
