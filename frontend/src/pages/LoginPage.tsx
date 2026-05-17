import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username.trim(), password)
      navigate('/')
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-discord-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-discord-accent mb-4">
            <Lock size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Chat In Peace</h1>
          <p className="text-discord-muted text-sm mt-1">End-to-end encrypted messaging</p>
        </div>

        <form onSubmit={submit} className="bg-discord-sidebar rounded-lg p-6 shadow-xl space-y-4">
          <div>
            <label className="block text-discord-muted text-xs font-semibold uppercase mb-1">Username</label>
            <input
              autoFocus
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              className="w-full bg-discord-bg text-discord-text px-3 py-2.5 rounded text-sm outline-none focus:ring-2 focus:ring-discord-accent"
              placeholder="your-username"
            />
          </div>
          <div>
            <label className="block text-discord-muted text-xs font-semibold uppercase mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full bg-discord-bg text-discord-text px-3 py-2.5 rounded text-sm outline-none focus:ring-2 focus:ring-discord-accent"
              placeholder="••••••••"
            />
          </div>
          {error && (
            <p className="text-discord-red text-sm bg-discord-red/10 px-3 py-2 rounded">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-discord-accent hover:bg-discord-accent-hover text-white rounded font-medium text-sm transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-discord-muted text-xs mt-4">
          Access is by invitation only.
        </p>
      </div>
    </div>
  )
}
