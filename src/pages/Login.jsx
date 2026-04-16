import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useStore } from '../store'
import { initOctokit } from '../services/github'
import { startDeviceFlow, pollForToken, openInBrowser } from '../services/auth'

export default function Login() {
  const { isLoggedIn, login } = useStore()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [userCode, setUserCode] = useState('')
  const [waiting, setWaiting] = useState(false)

  if (isLoggedIn) return <Navigate to="/projects" replace />

  async function handleLogin() {
    setError('')
    setLoading(true)
    try {
      const flow = await startDeviceFlow()
      setUserCode(flow.userCode)
      setWaiting(true)
      setLoading(false)

      await openInBrowser(flow.verificationUri)

      const token = await pollForToken(flow.deviceCode, flow.interval)
      initOctokit(token)
      login(token)
    } catch (err) {
      setError(err.message)
      setWaiting(false)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="fixed top-0 left-0 right-0 h-8" style={{ WebkitAppRegion: 'drag' }} />

      <div className="bg-surface-card rounded-2xl shadow-lifted p-10 w-full max-w-sm">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center gradient-primary">
            <img src="/logo.png" alt="ProjectHive" className="w-full h-full object-cover"
              onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<span style="color:white;font-weight:700;font-size:16px">PH</span>' }} />
          </div>
          <h1 className="text-2xl font-display font-bold text-on-surface">ProjectHive</h1>
        </div>
        <p className="text-on-surface-variant text-sm mb-8 ml-12">Sign in with your GitHub account</p>

        {error && (
          <div className="bg-[var(--color-error-surface)] text-[var(--color-error)] text-sm p-3 rounded-xl mb-4">{error}</div>
        )}

        {!waiting ? (
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 gradient-primary text-white py-3 rounded-full text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
          >
            <GitHubIcon />
            {loading ? 'Connecting...' : 'Sign in with GitHub'}
          </button>
        ) : (
          <div>
            <div className="bg-primary-surface rounded-2xl p-6 text-center mb-4">
              <p className="text-xs text-on-surface-variant mb-2">Enter this code on GitHub:</p>
              <p className="text-3xl font-mono font-bold text-on-surface tracking-widest select-all">
                {userCode}
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-on-surface-variant">
              <span className="inline-block w-2 h-2 gradient-primary rounded-full animate-pulse" />
              Waiting for authorization...
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function GitHubIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}
