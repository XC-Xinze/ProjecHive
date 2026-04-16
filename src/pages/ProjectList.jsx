import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { listGitSyncRepos, isRepoInitialized, initializeRepo, createProject, getConfig } from '../services/github'
import { REPO_PREFIX } from '../services/template'

export default function ProjectList() {
  const { logout, selectProject } = useStore()
  const navigate = useNavigate()
  const [repos, setRepos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // New project form
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newCodeRepo, setNewCodeRepo] = useState('')
  const [newPrivate, setNewPrivate] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => { loadRepos() }, [])

  async function loadRepos() {
    setLoading(true)
    setError('')
    try {
      const token = useStore.getState().token
      const found = await listGitSyncRepos(token)

      const enriched = await Promise.all(found.map(async (r) => {
        try {
          const { config } = await getConfig(r.owner.login, r.name)
          return { ...r, _projectName: config?.name, _initialized: true }
        } catch {
          return { ...r, _projectName: null, _initialized: false }
        }
      }))
      setRepos(enriched)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleOpen(repo) {
    if (!repo._initialized) {
      try {
        const name = repo.name.replace(/^gitsync-/i, '').replace(/-/g, ' ')
        await initializeRepo(repo.owner.login, repo.name, name, '')
      } catch (err) {
        setError(`Init failed: ${err.message}`)
        return
      }
    }
    selectProject(repo.owner.login, repo.name)
    navigate('/')
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    setError('')
    try {
      const repo = await createProject(
        newName.trim().toLowerCase().replace(/\s+/g, '-'),
        newDesc.trim(),
        newCodeRepo.trim(),
        newPrivate,
      )
      setRepos((prev) => [{
        ...repo,
        _projectName: newDesc.trim() || repo.name,
        _initialized: true,
      }, ...prev])
      setShowNew(false)
      setNewName('')
      setNewDesc('')
      setNewCodeRepo('')
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* macOS drag region */}
      <div className="h-8 shrink-0" style={{ WebkitAppRegion: 'drag' }} />

      <div className="max-w-3xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-xl font-display font-bold text-on-surface">Projects</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setShowNew(true)}
              className="px-4 py-2 gradient-primary text-white text-sm font-semibold rounded-full hover:opacity-90 transition-opacity cursor-pointer"
            >
              + New Project
            </button>
            <button
              onClick={loadRepos}
              disabled={loading}
              className="px-3 py-2 text-sm text-on-surface-variant bg-surface-card shadow-card rounded-full hover:shadow-lifted cursor-pointer disabled:opacity-50 transition-shadow"
            >
              Refresh
            </button>
            <button
              onClick={logout}
              className="px-3 py-2 text-sm text-on-surface-dim hover:text-[var(--color-error)] cursor-pointer transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-[var(--color-error-surface)] text-[var(--color-error)] text-sm p-3 rounded-xl mb-4">{error}</div>
        )}

        {/* New project form */}
        {showNew && (
          <form onSubmit={handleCreate} className="bg-surface-card rounded-2xl shadow-card p-6 mb-6 space-y-4">
            <h3 className="text-sm font-display font-semibold text-on-surface">Create New Project</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-on-surface-variant mb-1">Project Name</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. nlp-team"
                  required
                  autoFocus
                  className="w-full px-3 py-2 bg-surface-low border-0 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-on-surface"
                />
                <p className="text-[11px] text-on-surface-dim mt-1">
                  Repo: <span className="font-mono">{REPO_PREFIX}{newName.trim().toLowerCase().replace(/\s+/g, '-') || '...'}</span>
                </p>
              </div>
              <div>
                <label className="block text-xs text-on-surface-variant mb-1">Description</label>
                <input
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="What's this project about?"
                  className="w-full px-3 py-2 bg-surface-low border-0 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-on-surface"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Code Repository URL (optional)</label>
              <input
                value={newCodeRepo}
                onChange={(e) => setNewCodeRepo(e.target.value)}
                placeholder="https://github.com/owner/code-repo"
                className="w-full px-3 py-2 bg-surface-low border-0 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-on-surface"
              />
            </div>
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 text-xs text-on-surface-variant cursor-pointer">
                <input
                  type="checkbox"
                  checked={newPrivate}
                  onChange={(e) => setNewPrivate(e.target.checked)}
                  className="rounded accent-[var(--color-primary)]"
                />
                Private repository
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowNew(false)}
                  className="px-4 py-2 text-sm text-on-surface-variant hover:bg-surface-low rounded-full cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2 gradient-primary text-white text-sm font-semibold rounded-full hover:opacity-90 disabled:opacity-50 cursor-pointer transition-opacity"
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Project grid */}
        {loading ? (
          <div className="grid grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-surface-low rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : repos.length > 0 ? (
          <div className="grid grid-cols-2 gap-4">
            {repos.map((r) => (
              <button
                key={r.id}
                onClick={() => handleOpen(r)}
                className="text-left bg-surface-card hover:shadow-lifted shadow-card rounded-2xl p-5 transition-all cursor-pointer group"
              >
                <div className="flex items-start gap-3">
                  <img src={r.owner.avatar_url} alt="" className="w-10 h-10 rounded-xl shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
                      {r._projectName || r.name.replace(/^gitsync-/i, '')}
                    </p>
                    <p className="text-xs text-on-surface-dim font-mono truncate">{r.owner.login}/{r.name}</p>
                    {r.description && (
                      <p className="text-xs text-on-surface-variant mt-1 line-clamp-1">{r.description}</p>
                    )}
                  </div>
                </div>
                {!r._initialized && (
                  <span className="inline-block mt-2 px-2 py-0.5 bg-[var(--color-warning-surface)] text-[var(--color-warning)] text-[10px] rounded-full font-medium">
                    Not initialized
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="bg-surface-card shadow-card rounded-2xl p-10 text-center">
            <p className="text-sm text-on-surface-variant mb-1">No projects yet</p>
            <p className="text-xs text-on-surface-dim">
              Click <span className="font-medium text-on-surface">+ New Project</span> to create one, or create a <code className="bg-surface-low px-1.5 py-0.5 rounded-lg font-mono text-[11px]">{REPO_PREFIX}*</code> repo on GitHub.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
