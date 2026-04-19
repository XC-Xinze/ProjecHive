import { useEffect, useRef, useState } from 'react'

const STORAGE_PREFIX = 'projecthive-notes-'

export default function NotesDrawer({ open, onClose, projectKey }) {
  const storageKey = STORAGE_PREFIX + projectKey
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)
  const savedTimerRef = useRef(null)

  // Reload when project switches
  useEffect(() => {
    try {
      setValue(localStorage.getItem(storageKey) || '')
    } catch {
      setValue('')
    }
  }, [storageKey])

  // Esc to close
  useEffect(() => {
    if (!open) return
    function handle(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [open, onClose])

  // Clear timer on unmount
  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
  }, [])

  function handleChange(e) {
    const next = e.target.value
    setValue(next)
    try {
      localStorage.setItem(storageKey, next)
      setSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 800)
    } catch {}
  }

  if (!open) return null

  return (
    <div className="fixed top-0 right-0 bottom-0 w-80 bg-surface-card shadow-float z-40 flex flex-col border-l" style={{ borderColor: 'var(--color-surface-low)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--color-surface-low)' }}>
        <div className="min-w-0">
          <p className="font-display font-semibold text-sm text-on-surface">My Notes</p>
          <p className="text-[10px] text-on-surface-dim flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
            Local only · not synced to repo
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {saved && <span className="text-[10px] text-emerald-500 mr-1">saved</span>}
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-surface-low flex items-center justify-center cursor-pointer text-on-surface-dim hover:text-on-surface"
            title="Close (Esc)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <textarea
        value={value}
        onChange={handleChange}
        placeholder={`Personal scratch notes for this project.\n\nLives in localStorage on this device only — never committed, never seen by collaborators.`}
        spellCheck={false}
        className="flex-1 w-full px-4 py-3 bg-transparent text-sm text-on-surface resize-none outline-none placeholder:text-on-surface-dim leading-relaxed"
      />
    </div>
  )
}

export function NotesToggleTab({ onClick }) {
  return (
    <button
      onClick={onClick}
      title="Open my notes"
      className="fixed right-0 top-1/2 -translate-y-1/2 z-30 px-1.5 py-3 bg-surface-card hover:bg-primary-surface rounded-l-lg shadow-card hover:shadow-lifted transition-all cursor-pointer text-on-surface-dim hover:text-primary"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
      </svg>
    </button>
  )
}
