import { useEffect, useState, useRef } from 'react'
import { useStore } from '../store'
import { loadDocs, createDoc, getFileContent, deleteFile, uploadAsset, getRawFileBase64 } from '../services/github'
import { detectFileType, getMimeType, isUploadedAsset } from '../utils/fileTypes'

const TYPE_OPTIONS = [
  { value: 'link', label: 'Link', icon: '🔗' },
  { value: 'image', label: 'Image', icon: '🖼' },
  { value: 'document', label: 'Document', icon: '📄' },
  { value: 'dataset', label: 'Dataset', icon: '📊' },
]

export default function Docs() {
  const { owner, repo, currentUser, addPendingWrite, mergePending, getCached, setCached } = useStore()
  const [docs, setDocs] = useState(() => getCached(owner, repo, 'docs') || [])

  // Merge remote docs with locally-pending creates not yet propagated.
  function mergeDocs(remote) {
    const survivors = mergePending('docs', remote)
    if (!survivors.length) return remote
    return [...survivors, ...remote] // newest-first; pending are most recent
  }
  const [loading, setLoading] = useState(() => !getCached(owner, repo, 'docs'))
  const [showForm, setShowForm] = useState(false)
  const [filterType, setFilterType] = useState(null)

  // Form
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [type, setType] = useState('link')
  const [desc, setDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const cached = getCached(owner, repo, 'docs')
    if (cached) { setDocs(cached); setLoading(false) }
    else setLoading(true)
    loadDocs(owner, repo)
      .then((d) => {
        if (cancelled) return
        const merged = mergeDocs(d)
        setDocs(merged)
        setCached(owner, repo, 'docs', d)
      })
      .catch(() => {
        // Leave existing docs in place — don't blank the UI on transient errors.
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [owner, repo])

  async function handleCreate(e) {
    e.preventDefault()
    setCreating(true)
    try {
      const doc = await createDoc(owner, repo, {
        title: title.trim(),
        url: url.trim(),
        type,
        description: desc.trim(),
        sharedBy: currentUser?.login || 'unknown',
      })
      addPendingWrite('docs', doc)
      setDocs((prev) => [doc, ...prev])
      setShowForm(false)
      setTitle(''); setUrl(''); setDesc('')
    } catch (err) {
      alert(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleDocOpen(doc) {
    if (!isUploadedAsset(doc.url)) {
      // External URL — open in system browser
      if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(doc.url)
      } else {
        window.open(doc.url, '_blank', 'noopener')
      }
      return
    }
    // Repo-relative path — fetch from GitHub and open with system default app
    try {
      const { content, name } = await getRawFileBase64(owner, repo, doc.url)
      const raw = content.replace(/\n/g, '')
      if (window.electronAPI?.openFile) {
        await window.electronAPI.openFile(raw, name)
      } else {
        const binary = atob(raw)
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
        const blob = new Blob([bytes], { type: getMimeType(name) })
        const blobUrl = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = blobUrl
        link.download = name
        link.click()
        URL.revokeObjectURL(blobUrl)
      }
    } catch (err) {
      alert(`Failed to open file: ${err.message}`)
    }
  }

  async function handleDelete(doc) {
    if (!confirm(`Delete "${doc.title}"?`)) return
    setDocs((prev) => prev.filter((d) => d.id !== doc.id))
    useStore.getState().removePendingWrite('docs', doc.id)
    try {
      const { sha } = await getFileContent(owner, repo, doc._path)
      await deleteFile(owner, repo, doc._path, `[doc] Delete "${doc.title}"`, sha)
    } catch (err) {
      loadDocs(owner, repo).then((d) => setDocs(mergeDocs(d)))
      alert(`Delete failed: ${err.message}`)
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 25 * 1024 * 1024) { alert('File too large (max 25MB)'); return }
    if (!confirm(`Upload "${file.name}" (${(file.size / 1024).toFixed(1)} KB) and commit it to the repository?\n\nMake sure this file does not contain sensitive information.`)) {
      e.target.value = ''
      return
    }
    setUploading(true)
    try {
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result.split(',')[1])
        reader.readAsDataURL(file)
      })
      const result = await uploadAsset(owner, repo, file.name, base64)
      setUrl(result.path)
      setTitle((prev) => prev || file.name)
      setType(detectFileType(file.name))
    } catch (err) {
      alert(`Upload failed: ${err.message}`)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const filtered = filterType ? docs.filter((d) => d.type === filterType) : docs

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-bold text-xl text-on-surface">Docs & Links</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 gradient-primary text-white text-sm rounded-full hover:opacity-90 cursor-pointer"
        >
          + Share
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-surface-card rounded-xl shadow-card p-5 mb-4 space-y-3">
          <div className="flex gap-1.5">
            {TYPE_OPTIONS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={`px-3 py-1 rounded-full text-xs cursor-pointer transition-all ${
                  type === t.value
                    ? 'gradient-primary text-white'
                    : 'bg-surface-card text-on-surface-variant shadow-card hover:shadow-lifted'
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" required
              className="px-3 py-1.5 bg-surface-low border-0 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" />
            <div className="flex gap-2">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL or upload a file" required
                className="flex-1 px-3 py-1.5 bg-surface-low border-0 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" />
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="px-3 py-1.5 text-xs bg-surface-low text-on-surface-variant rounded-lg hover:shadow-card cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap">
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description (optional)"
            className="w-full px-3 py-1.5 bg-surface-low border-0 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-sm text-on-surface-variant hover:bg-surface-low rounded-lg cursor-pointer">Cancel</button>
            <button type="submit" disabled={creating}
              className="px-4 py-1.5 gradient-primary text-white text-sm rounded-full hover:opacity-90 disabled:opacity-50 cursor-pointer">
              {creating ? 'Sharing...' : 'Share'}
            </button>
          </div>
        </form>
      )}

      {/* Type filter */}
      <div className="flex gap-1.5 mb-4">
        <button onClick={() => setFilterType(null)}
          className={`px-2.5 py-1 text-xs rounded-full cursor-pointer ${!filterType ? 'gradient-primary text-white' : 'bg-surface-card text-on-surface-variant shadow-card'}`}>
          All
        </button>
        {TYPE_OPTIONS.map((t) => (
          <button key={t.value} onClick={() => setFilterType(filterType === t.value ? null : t.value)}
            className={`px-2.5 py-1 text-xs rounded-full cursor-pointer ${filterType === t.value ? 'gradient-primary text-white' : 'bg-surface-card text-on-surface-variant shadow-card'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-surface-low rounded-xl animate-pulse" />)}</div>
      ) : filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((doc) => (
            <div key={doc.id} className="bg-surface-card rounded-xl shadow-card p-4 hover:shadow-lifted transition-all group relative">
              <button onClick={() => handleDocOpen(doc)} className="w-full flex items-start gap-3 text-left cursor-pointer">
                <span className="text-xl mt-0.5">{TYPE_OPTIONS.find((t) => t.value === doc.type)?.icon || '📎'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-on-surface truncate">{doc.title}</p>
                  {doc.description && <p className="text-xs text-on-surface-variant mt-0.5 line-clamp-1">{doc.description}</p>}
                  <div className="flex items-center gap-2 mt-1.5">
                    <img src={`https://github.com/${doc.sharedBy}.png?size=32`} alt="" className="w-4 h-4 rounded-full" />
                    <span className="text-xs text-on-surface-dim">{doc.sharedBy}</span>
                    <span className="text-xs text-on-surface-dim">·</span>
                    <span className="text-xs text-on-surface-dim">{new Date(doc.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <span className="text-xs text-on-surface-dim font-mono truncate max-w-[200px] shrink-0">{doc.url}</span>
              </button>
              {/* Delete button */}
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(doc) }}
                className="absolute top-3 right-3 p-1 rounded-lg text-on-surface-dim hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                title="Delete"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-on-surface-dim text-sm text-center py-12">No documents shared yet.</div>
      )}
    </div>
  )
}
