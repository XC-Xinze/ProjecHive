import { useEffect, useMemo, useRef, useState } from 'react'
import { listDirectory, getFileContent, loadMessages, loadTopics, loadDocs } from '../services/github'

async function loadTasksLite(owner, repo) {
  try {
    const files = await listDirectory(owner, repo, 'tasks')
    const jsonFiles = files.filter((f) => f.name.endsWith('.json'))
    return Promise.all(jsonFiles.map(async (f) => {
      const { content } = await getFileContent(owner, repo, f.path)
      return JSON.parse(content)
    }))
  } catch {
    return []
  }
}

const KIND_BADGE = {
  task:    { label: 'task',    cls: 'bg-blue-100 text-blue-700' },
  message: { label: 'message', cls: 'bg-emerald-100 text-emerald-700' },
  topic:   { label: 'topic',   cls: 'bg-purple-100 text-purple-700' },
  doc:     { label: 'doc',     cls: 'bg-amber-100 text-amber-700' },
}

function snippet(text, query, max = 80) {
  if (!text) return ''
  const lower = text.toLowerCase()
  const i = lower.indexOf(query.toLowerCase())
  if (i < 0) return text.slice(0, max) + (text.length > max ? '…' : '')
  const start = Math.max(0, i - 20)
  const end = Math.min(text.length, i + query.length + 60)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

export default function SearchPalette({ open, onClose, owner, repo, navigate }) {
  const [query, setQuery] = useState('')
  const [data, setData] = useState({ tasks: [], messages: [], topics: [], docs: [] })
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef(null)

  // Refetch on every open so newly-created items show up. Bail out if a
  // later open arrived while we were still resolving (cancelled flag).
  useEffect(() => {
    if (!open || !owner || !repo) return
    let cancelled = false
    setLoading(true)
    setQuery('')
    setActiveIndex(0)
    Promise.all([
      loadTasksLite(owner, repo),
      loadMessages(owner, repo).catch(() => []),
      loadTopics(owner, repo).catch(() => []),
      loadDocs(owner, repo).catch(() => []),
    ]).then(([tasks, messages, topics, docs]) => {
      if (cancelled) return
      setData({ tasks, messages, topics, docs })
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [open, owner, repo])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const r = []
    for (const t of data.tasks) {
      const hay = `${t.title || ''} ${t.description || ''} ${(t.labels || []).join(' ')}`
      if (hay.toLowerCase().includes(q)) {
        r.push({
          kind: 'task',
          id: t.id,
          title: t.title || '(untitled task)',
          subtitle: `${t.status || 'todo'}${t.dueDate ? ` · due ${new Date(t.dueDate).toLocaleDateString()}` : ''}`,
          route: `/board?task=${encodeURIComponent(t.title || '')}`,
        })
      }
    }
    for (const m of data.messages) {
      if ((m.body || '').toLowerCase().includes(q)) {
        r.push({
          kind: 'message',
          id: m.id,
          title: snippet(m.body, q),
          subtitle: `${m.author || 'unknown'} · ${new Date(m.createdAt).toLocaleDateString()}`,
          route: `/messages?highlight=${encodeURIComponent(m.id)}`,
        })
      }
    }
    for (const t of data.topics) {
      const hay = `${t.title || ''} ${t.category || ''}`
      if (hay.toLowerCase().includes(q)) {
        r.push({
          kind: 'topic',
          id: t.id,
          title: `#!${t.title}`,
          subtitle: `${t.category || 'topic'}${t.status === 'done' ? ' · archived' : ''}`,
          route: `/messages?topic=${encodeURIComponent(t.title || '')}`,
        })
      }
    }
    for (const d of data.docs) {
      const hay = `${d.title || ''} ${d.description || ''} ${d.url || ''}`
      if (hay.toLowerCase().includes(q)) {
        r.push({
          kind: 'doc',
          id: d.id,
          title: d.title || '(untitled doc)',
          subtitle: d.description ? snippet(d.description, q, 60) : (d.type || 'doc'),
          route: '/docs',
        })
      }
    }
    return r.slice(0, 40)
  }, [data, query])

  // Reset active index when results change
  useEffect(() => { setActiveIndex(0) }, [query])

  // Scroll active row into view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector(`[data-row="${activeIndex}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function selectResult(r) {
    onClose()
    navigate(r.route)
  }

  function handleKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      const pick = results[activeIndex]
      if (pick) { e.preventDefault(); selectResult(pick) }
    }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-24" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-surface-card rounded-2xl shadow-float w-full max-w-xl mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 border-b" style={{ borderColor: 'var(--color-surface-low)' }}>
          <svg className="w-4 h-4 text-on-surface-dim shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search tasks, messages, topics, docs…"
            className="flex-1 py-3.5 bg-transparent outline-none text-sm text-on-surface placeholder:text-on-surface-dim"
          />
          <kbd className="text-[10px] text-on-surface-dim px-1.5 py-0.5 bg-surface-low rounded shrink-0">esc</kbd>
        </div>

        <div ref={listRef} className="max-h-96 overflow-y-auto">
          {loading && (
            <div className="p-6 text-center text-xs text-on-surface-dim animate-pulse">Loading…</div>
          )}
          {!loading && !query && (
            <div className="p-6 text-center text-xs text-on-surface-dim">
              Type to search across {data.tasks.length} tasks · {data.messages.length} messages · {data.topics.length} topics · {data.docs.length} docs
            </div>
          )}
          {!loading && query && results.length === 0 && (
            <div className="p-6 text-center text-xs text-on-surface-dim">No matches</div>
          )}
          {!loading && results.map((r, i) => {
            const badge = KIND_BADGE[r.kind]
            return (
              <button
                key={`${r.kind}-${r.id}-${i}`}
                data-row={i}
                onClick={() => selectResult(r)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`w-full text-left px-4 py-2.5 flex items-start gap-3 transition-colors cursor-pointer ${
                  activeIndex === i ? 'bg-primary-surface' : ''
                }`}
              >
                <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${badge.cls}`}>
                  {badge.label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-on-surface truncate">{r.title}</p>
                  <p className="text-[11px] text-on-surface-dim truncate">{r.subtitle}</p>
                </div>
              </button>
            )
          })}
        </div>

        <div className="px-4 py-2 border-t flex items-center gap-3 text-[10px] text-on-surface-dim" style={{ borderColor: 'var(--color-surface-low)' }}>
          <span className="flex items-center gap-1"><kbd className="px-1 bg-surface-low rounded">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="px-1 bg-surface-low rounded">↵</kbd> select</span>
          <span className="ml-auto">⌘K to reopen</span>
        </div>
      </div>
    </div>
  )
}
