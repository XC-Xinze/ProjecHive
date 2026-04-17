import { useEffect, useState } from 'react'
import { getRepoTree } from '../services/github'

export default function FilePicker({ owner, repo, onSelect, onClose }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    getRepoTree(owner, repo)
      .then((tree) => setFiles(tree))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [owner, repo])

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? files.filter((f) => f.path.toLowerCase().includes(q))
    : files

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className="relative bg-surface-card rounded-xl shadow-float w-full max-w-lg mx-4 max-h-[70vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b" style={{ borderColor: 'var(--color-surface-low)' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-sm text-on-surface">Reference a file</h3>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-dim hover:text-on-surface hover:bg-surface-low transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder="Search files..."
            className="w-full px-3 py-2 bg-surface-low rounded-lg border-0 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="space-y-1.5 p-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-7 bg-surface-low rounded animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="p-4 text-sm text-red-500">Failed to load files: {error}</div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-sm text-on-surface-dim text-center">
              {q ? 'No files match.' : 'No files in this repository.'}
            </div>
          ) : (
            <ul>
              {filtered.slice(0, 200).map((f) => {
                const name = f.path.split('/').pop()
                const dir = f.path.slice(0, f.path.length - name.length)
                return (
                  <li key={f.path}>
                    <button
                      onClick={() => onSelect({ name, path: f.path })}
                      className="w-full flex items-baseline gap-2 px-3 py-1.5 rounded-lg hover:bg-surface-low text-left cursor-pointer text-xs"
                    >
                      <span className="text-on-surface font-medium truncate">{name}</span>
                      {dir && (
                        <span className="text-on-surface-dim font-mono truncate flex-1">{dir}</span>
                      )}
                    </button>
                  </li>
                )
              })}
              {filtered.length > 200 && (
                <li className="px-3 py-2 text-[11px] text-on-surface-dim text-center">
                  Showing first 200 of {filtered.length} matches. Refine your search.
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
