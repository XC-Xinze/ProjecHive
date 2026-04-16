import { useState } from 'react'

export default function ConflictDialog({ remoteMeta, onOverwrite, onRefresh, onCancel }) {
  const [loading, setLoading] = useState(false)

  async function handle(action) {
    setLoading(true)
    try {
      if (action === 'overwrite') await onOverwrite()
      else await onRefresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card rounded-2xl shadow-float p-6 w-full max-w-sm">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-8 h-8 bg-[var(--color-warning-surface)] text-[var(--color-warning)] rounded-full flex items-center justify-center text-lg font-bold shrink-0">!</span>
          <h3 className="text-base font-display font-semibold text-on-surface">Conflict Detected</h3>
        </div>

        <p className="text-sm text-on-surface-variant mb-1">
          This file was modified by someone else since you last loaded it.
        </p>

        {remoteMeta && (
          <div className="bg-surface-low rounded-xl p-3 my-3 text-xs text-on-surface-dim space-y-0.5">
            {remoteMeta.updatedBy && <p>Updated by: <span className="text-on-surface font-medium">{remoteMeta.updatedBy}</span></p>}
            {remoteMeta.updatedAt && <p>At: <span className="text-on-surface">{new Date(remoteMeta.updatedAt).toLocaleString()}</span></p>}
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={() => handle('refresh')}
            disabled={loading}
            className="flex-1 px-3 py-2 gradient-primary text-white text-sm font-medium rounded-full hover:opacity-90 disabled:opacity-50 cursor-pointer transition-opacity"
          >
            Refresh Local
          </button>
          <button
            onClick={() => handle('overwrite')}
            disabled={loading}
            className="flex-1 px-3 py-2 bg-[var(--color-error-surface)] text-[var(--color-error)] text-sm font-medium rounded-full hover:opacity-80 disabled:opacity-50 cursor-pointer transition-opacity"
          >
            Force Overwrite
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-3 py-2 text-on-surface-dim text-sm hover:bg-surface-low rounded-full cursor-pointer transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
