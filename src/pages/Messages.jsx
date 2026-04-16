import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { loadMessages, createMessage, getCollaborators, listDirectory, getFileContent, updateFile, deleteFile, uploadAsset, getRawFileBase64 } from '../services/github'

const LABELS = [
  { key: 'question', label: 'Question', color: 'bg-blue-100 text-blue-700' },
  { key: 'announcement', label: 'Announce', color: 'bg-indigo-100 text-indigo-700' },
  { key: 'idea', label: 'Idea', color: 'bg-emerald-100 text-emerald-700' },
  { key: 'bug', label: 'Bug', color: 'bg-red-100 text-red-700' },
  { key: 'urgent', label: 'Urgent', color: 'bg-amber-100 text-amber-700' },
]

const LABEL_COLOR_MAP = Object.fromEntries(LABELS.map((l) => [l.key, l.color]))

const REACTION_EMOJIS = ['\u{1F44D}', '\u{1F44E}', '\u{2764}\u{FE0F}', '\u{1F604}', '\u{1F389}', '\u{1F914}', '\u{1F440}', '\u{1F680}']

export default function Messages() {
  const { owner, repo, currentUser, markMsgRead } = useStore()
  const navigate = useNavigate()
  const [messages, setMessages] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // all | mine | mentions | label-*
  const pollRef = useRef(null)

  // Compose
  const [body, setBody] = useState('')
  const [refType, setRefType] = useState('')
  const [refId, setRefId] = useState('')
  const [composeLabel, setComposeLabel] = useState('')
  const [posting, setPosting] = useState(false)
  const [showMentionPicker, setShowMentionPicker] = useState(false)
  const [showTaskPicker, setShowTaskPicker] = useState(false)
  const [availableTasks, setAvailableTasks] = useState([])

  // Attachments
  const [attachments, setAttachments] = useState([]) // [{name, path}]
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  // Reactions & threads
  const [reactionPickerMsg, setReactionPickerMsg] = useState(null)
  const [expandedThread, setExpandedThread] = useState(null)
  const [threadReplyBody, setThreadReplyBody] = useState('')
  const [threadPosting, setThreadPosting] = useState(false)

  useEffect(() => {
    loadAll()
    markMsgRead()
    pollRef.current = setInterval(() => silentRefresh(), 30000)
    return () => clearInterval(pollRef.current)
  }, [owner, repo])

  async function loadAll() {
    setLoading(true)
    const [msgs, collabs, tasks] = await Promise.all([
      loadMessages(owner, repo),
      getCollaborators(owner, repo),
      loadTasks(),
    ])
    setMessages(msgs)
    setMembers(collabs)
    setAvailableTasks(tasks)
    setLoading(false)
  }

  async function loadTasks() {
    try {
      const files = await listDirectory(owner, repo, 'tasks')
      const jsonFiles = files.filter((f) => f.name.endsWith('.json'))
      const tasks = await Promise.all(jsonFiles.map(async (f) => {
        const { content } = await getFileContent(owner, repo, f.path)
        return JSON.parse(content)
      }))
      return tasks
    } catch {
      return []
    }
  }

  async function silentRefresh() {
    try {
      const msgs = await loadMessages(owner, repo)
      setMessages(msgs)
    } catch {}
  }

  // ── Generic update helper ──
  async function updateMessage(msg, updates) {
    const { content, sha } = await getFileContent(owner, repo, msg._path)
    const latest = JSON.parse(content)
    Object.assign(latest, updates)
    const result = await updateFile(owner, repo, msg._path, JSON.stringify(latest, null, 2), `[discuss] Update message`, sha)
    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, ...updates, _sha: result.content.sha } : m))
  }

  // ── Delete message ──
  async function handleDeleteMessage(msg) {
    if (!confirm('Delete this message?')) return
    setMessages((prev) => prev.filter((m) => m.id !== msg.id))
    try {
      const { sha } = await getFileContent(owner, repo, msg._path)
      await deleteFile(owner, repo, msg._path, `[discuss] Delete message`, sha)
    } catch (err) {
      silentRefresh()
      alert(`Delete failed: ${err.message}`)
    }
  }

  // ── Pin toggle ──
  async function togglePin(msg) {
    const newPinned = !msg.pinned
    // Optimistic update
    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, pinned: newPinned } : m))
    try {
      await updateMessage(msg, { pinned: newPinned })
    } catch (err) {
      // Revert on failure
      setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, pinned: !newPinned } : m))
      console.error('Failed to toggle pin:', err)
    }
  }

  // ── Reactions ──
  async function toggleReaction(msg, emoji) {
    const me = currentUser?.login
    if (!me) return
    const reactions = { ...(msg.reactions || {}) }
    const users = reactions[emoji] ? [...reactions[emoji]] : []
    const idx = users.indexOf(me)
    if (idx >= 0) {
      users.splice(idx, 1)
    } else {
      users.push(me)
    }
    if (users.length > 0) {
      reactions[emoji] = users
    } else {
      delete reactions[emoji]
    }
    // Optimistic update
    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, reactions } : m))
    setReactionPickerMsg(null)
    try {
      await updateMessage(msg, { reactions })
    } catch (err) {
      // Revert
      setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, reactions: msg.reactions } : m))
      console.error('Failed to update reaction:', err)
    }
  }

  // ── Thread reply ──
  async function handleThreadReply(parentMsg) {
    if (!threadReplyBody.trim()) return
    setThreadPosting(true)
    try {
      const trimmed = threadReplyBody.trim()
      const taskRefs = (trimmed.match(/#(\S+)/g) || []).map((t) => t.slice(1))
      const replyMsg = {
        author: currentUser?.login || 'unknown',
        body: trimmed,
        ref: null,
        taskRefs,
        replyTo: parentMsg.id,
      }
      const created = await createMessage(owner, repo, replyMsg)
      setMessages((prev) => [created, ...prev])
      setThreadReplyBody('')
    } catch (err) {
      alert(err.message)
    } finally {
      setThreadPosting(false)
    }
  }

  async function handlePost(e) {
    e.preventDefault()
    if (!body.trim()) return
    setPosting(true)
    try {
      const trimmedBody = body.trim()
      const taskRefs = (trimmedBody.match(/#(\S+)/g) || []).map((t) => t.slice(1))
      const msg = {
        author: currentUser?.login || 'unknown',
        body: trimmedBody,
        ref: refType && refId ? { type: refType, id: refId } : null,
        taskRefs,
        label: composeLabel || null,
        pinned: false,
        reactions: {},
        replyTo: null,
        attachments: attachments.length > 0 ? attachments : undefined,
      }
      const created = await createMessage(owner, repo, msg)
      setMessages((prev) => [created, ...prev])
      setBody('')
      setRefType('')
      setRefId('')
      setComposeLabel('')
      setAttachments([])
      markMsgRead()
    } catch (err) {
      alert(err.message)
    } finally {
      setPosting(false)
    }
  }

  async function handleFileSelect(e) {
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
      setAttachments((prev) => [...prev, { name: file.name, path: result.path }])
    } catch (err) {
      alert(`Upload failed: ${err.message}`)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function insertMention(login) {
    setBody((prev) => prev + `@${login} `)
    setShowMentionPicker(false)
  }

  function insertTaskRef(title) {
    setBody((prev) => prev + `#${title} `)
    setShowTaskPicker(false)
  }

  const me = currentUser?.login

  // Separate replies from top-level messages
  const allReplies = messages.filter((m) => m.replyTo)
  const topLevel = messages.filter((m) => !m.replyTo)

  // Build reply counts and grouped replies per parent
  const repliesByParent = {}
  for (const r of allReplies) {
    if (!repliesByParent[r.replyTo]) repliesByParent[r.replyTo] = []
    repliesByParent[r.replyTo].push(r)
  }
  // Sort replies chronologically (oldest first)
  for (const key of Object.keys(repliesByParent)) {
    repliesByParent[key].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
  }

  // Helper: check if a message mentions me
  const meLower = me?.toLowerCase()
  function mentionsMe(m) {
    if (!meLower) return false
    return m.mentions?.some((u) => u.toLowerCase() === meLower) ||
      m.body?.toLowerCase().includes(`@${meLower}`)
  }

  // For @Me filter, also surface parent messages whose replies mention me
  const parentIdsWithMentionedReplies = new Set()
  if (filter === 'mentions') {
    for (const r of allReplies) {
      if (mentionsMe(r) && r.replyTo) parentIdsWithMentionedReplies.add(r.replyTo)
    }
  }

  // Apply filters to top-level messages
  const filtered = topLevel.filter((m) => {
    if (filter === 'mine') return m.author === me
    if (filter === 'mentions') return mentionsMe(m) || parentIdsWithMentionedReplies.has(m.id)
    if (filter.startsWith('label-')) return m.label === filter.slice(6)
    return true
  })

  // Split pinned vs unpinned
  const pinned = filtered.filter((m) => m.pinned)
  const unpinned = filtered.filter((m) => !m.pinned)

  return (
    <div className="p-8 max-w-3xl">
      <h2 className="font-display font-bold text-xl text-on-surface mb-4">Messages</h2>

      {/* Compose */}
      <form onSubmit={handlePost} className="bg-surface-card rounded-xl shadow-card p-5 mb-6">
        <div className="flex gap-2 mb-2">
          <div className="relative flex-1">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write a message... use @username to mention someone"
              rows={2}
              required
              className="w-full px-3 py-2 bg-surface-low border-0 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-none"
            />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            {/* @ mention picker */}
            <div className="relative">
              <button type="button" onClick={() => setShowMentionPicker(!showMentionPicker)}
                className="px-2 py-1 text-xs bg-surface-low text-on-surface-variant rounded-lg hover:shadow-card cursor-pointer">
                @ Mention
              </button>
              {showMentionPicker && (
                <div className="absolute bottom-full left-0 mb-1 bg-surface-card rounded-xl shadow-float py-1 min-w-[160px] z-10">
                  {members.map((m) => (
                    <button key={m.login} type="button" onClick={() => insertMention(m.login)}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-surface-low flex items-center gap-2 cursor-pointer">
                      <img src={m.avatar_url} alt="" className="w-5 h-5 rounded-full" />
                      {m.login}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* # task picker */}
            <div className="relative">
              <button type="button" onClick={() => setShowTaskPicker(!showTaskPicker)}
                className="px-2 py-1 text-xs bg-surface-low text-on-surface-variant rounded-lg hover:shadow-card cursor-pointer">
                # Task
              </button>
              {showTaskPicker && (
                <div className="absolute bottom-full left-0 mb-1 bg-surface-card rounded-xl shadow-float py-1 min-w-[200px] max-h-48 overflow-y-auto z-10">
                  {availableTasks.length > 0 ? availableTasks.map((t) => (
                    <button key={t.id || t.title} type="button" onClick={() => insertTaskRef(t.title)}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-surface-low flex items-center gap-2 cursor-pointer">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotColor(t.status)}`} />
                      <span className="truncate flex-1">{t.title}</span>
                      {t.assignee && (
                        <img src={`https://github.com/${t.assignee}.png?size=20`} alt={t.assignee}
                          className="w-4 h-4 rounded-full shrink-0" />
                      )}
                    </button>
                  )) : (
                    <div className="px-3 py-1.5 text-xs text-on-surface-dim">No tasks found</div>
                  )}
                </div>
              )}
            </div>

            {/* Label selector */}
            <div className="flex items-center gap-1">
              {LABELS.map((l) => (
                <button key={l.key} type="button" onClick={() => setComposeLabel(composeLabel === l.key ? '' : l.key)}
                  className={`px-1.5 py-0.5 text-[10px] rounded-full cursor-pointer transition-all ${
                    composeLabel === l.key ? l.color + ' ring-1 ring-current' : 'bg-surface-low text-on-surface-dim hover:text-on-surface-variant'
                  }`}>
                  {l.label}
                </button>
              ))}
            </div>

            {/* File attach */}
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="px-2 py-1 text-xs bg-surface-low text-on-surface-variant rounded-lg hover:shadow-card cursor-pointer disabled:opacity-50">
              {uploading ? 'Uploading...' : '+ File'}
            </button>

            {/* Ref picker */}
            <select value={refType} onChange={(e) => setRefType(e.target.value)}
              className="text-xs bg-surface-low border-0 rounded-lg px-2 py-1 text-on-surface-variant">
              <option value="">No reference</option>
              <option value="commit">Commit</option>
              <option value="task">Task</option>
            </select>
            {refType && (
              <input value={refId} onChange={(e) => setRefId(e.target.value)}
                placeholder={refType === 'commit' ? 'SHA (e.g. abc1234)' : 'Task ID'}
                className="text-xs bg-surface-low border-0 rounded-lg px-2 py-1 w-36 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" />
            )}
          </div>
          <button type="submit" disabled={posting || !body.trim()}
            className="px-4 py-1.5 gradient-primary text-white text-sm rounded-full hover:opacity-90 disabled:opacity-50 cursor-pointer shrink-0">
            {posting ? 'Sending...' : 'Send'}
          </button>
        </div>
        {/* Attachment preview */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {attachments.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-surface-low rounded-lg text-xs text-on-surface-variant">
                <FileIcon className="w-3 h-3" />
                {a.name}
                <button type="button" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  className="text-on-surface-dim hover:text-red-500 cursor-pointer ml-0.5">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}
      </form>

      {/* Filters */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {[
          { key: 'all', label: 'All' },
          { key: 'mentions', label: `@${me || 'Me'}` },
          { key: 'mine', label: 'My posts' },
          ...LABELS.map((l) => ({ key: `label-${l.key}`, label: l.label })),
        ].map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-2.5 py-1 text-xs rounded-full cursor-pointer ${filter === f.key ? 'gradient-primary text-white' : 'bg-surface-card text-on-surface-variant shadow-card'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Pinned section */}
      {pinned.length > 0 && (
        <div className="bg-primary-surface rounded-xl p-4 mb-4">
          <div className="flex items-center gap-1.5 mb-3 text-primary text-xs font-medium">
            <PinIcon className="w-3.5 h-3.5" />
            Pinned
          </div>
          <div className="space-y-2">
            {pinned.map((msg) => (
              <MessageCard
                key={msg.id}
                msg={msg}
                me={me}
                owner={owner}
                repo={repo}
                navigate={navigate}
                repliesByParent={repliesByParent}
                expandedThread={expandedThread}
                setExpandedThread={setExpandedThread}
                threadReplyBody={threadReplyBody}
                setThreadReplyBody={setThreadReplyBody}
                threadPosting={threadPosting}
                handleThreadReply={handleThreadReply}
                togglePin={togglePin}
                toggleReaction={toggleReaction}
                reactionPickerMsg={reactionPickerMsg}
                setReactionPickerMsg={setReactionPickerMsg}
                onDelete={handleDeleteMessage}
                taskList={availableTasks}
              />
            ))}
          </div>
        </div>
      )}

      {/* Messages list */}
      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-surface-low rounded-xl animate-pulse" />)}</div>
      ) : unpinned.length > 0 || pinned.length > 0 ? (
        <div className="space-y-3">
          {unpinned.map((msg) => (
            <MessageCard
              key={msg.id}
              msg={msg}
              me={me}
              owner={owner}
              repo={repo}
              navigate={navigate}
              taskList={availableTasks}
              repliesByParent={repliesByParent}
              expandedThread={expandedThread}
              setExpandedThread={setExpandedThread}
              threadReplyBody={threadReplyBody}
              setThreadReplyBody={setThreadReplyBody}
              threadPosting={threadPosting}
              handleThreadReply={handleThreadReply}
              togglePin={togglePin}
              toggleReaction={toggleReaction}
              reactionPickerMsg={reactionPickerMsg}
              setReactionPickerMsg={setReactionPickerMsg}
              onDelete={handleDeleteMessage}
            />
          ))}
        </div>
      ) : (
        <div className="text-on-surface-dim text-sm text-center py-12">No messages yet.</div>
      )}
    </div>
  )
}

// ── Message Card Component ──

function MessageCard({
  msg, me, owner, repo, taskList, navigate, repliesByParent, expandedThread, setExpandedThread,
  threadReplyBody, setThreadReplyBody, threadPosting, handleThreadReply,
  togglePin, toggleReaction, reactionPickerMsg, setReactionPickerMsg,
  onDelete,
}) {
  const replies = repliesByParent[msg.id] || []
  const replyCount = replies.length
  const isExpanded = expandedThread === msg.id
  const reactions = msg.reactions || {}
  const reactionEntries = Object.entries(reactions).filter(([, users]) => users.length > 0)

  return (
    <div className="bg-surface-card rounded-xl shadow-card p-4 hover:shadow-lifted transition-all group relative">
      {/* Top-right actions (visible on hover) */}
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <button
          onClick={() => togglePin(msg)}
          className={`p-1 rounded-lg transition-all cursor-pointer ${
            msg.pinned
              ? 'text-primary opacity-100'
              : 'text-on-surface-dim hover:text-primary opacity-0 group-hover:opacity-100'
          }`}
          title={msg.pinned ? 'Unpin message' : 'Pin message'}
        >
          <PinIcon className="w-4 h-4" />
        </button>
        {msg.author === me && onDelete && (
          <button
            onClick={() => onDelete(msg)}
            className="p-1 rounded-lg transition-all cursor-pointer text-on-surface-dim hover:text-red-500 opacity-0 group-hover:opacity-100"
            title="Delete message"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex items-start gap-3">
        <img src={`https://github.com/${msg.author}.png?size=40`} alt=""
          className="w-8 h-8 rounded-full shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-on-surface">{msg.author}</span>
            <span className="text-xs text-on-surface-dim">{formatTime(msg.createdAt)}</span>
            {msg.label && LABEL_COLOR_MAP[msg.label] && (
              <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-medium ${LABEL_COLOR_MAP[msg.label]}`}>
                {msg.label}
              </span>
            )}
          </div>
          <p className="text-sm text-on-surface-variant whitespace-pre-wrap">
            {renderBody(msg.body, taskList, navigate)}
          </p>
          {msg.ref && (
            <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 bg-surface-low rounded-lg text-xs text-on-surface-variant">
              <span className="font-medium">{msg.ref.type}:</span>
              <span className="font-mono">{msg.ref.id}</span>
            </div>
          )}
          {msg.mentions?.length > 0 && (
            <div className="flex gap-1 mt-2">
              {msg.mentions.map((u) => (
                <span key={u} className="px-1.5 py-0.5 bg-primary-surface text-primary text-[10px] rounded-lg font-medium">
                  @{u}
                </span>
              ))}
            </div>
          )}

          {/* Attachments */}
          {msg.attachments?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {msg.attachments.map((a, i) => (
                <button
                  key={i}
                  onClick={async (e) => {
                    e.stopPropagation()
                    try {
                      const { content, name } = await getRawFileBase64(owner, repo, a.path)
                      const raw = content.replace(/\n/g, '')
                      // Electron: save to temp and open with system app
                      if (window.electronAPI?.openFile) {
                        await window.electronAPI.openFile(raw, name)
                      } else {
                        // Browser fallback: download
                        const binary = atob(raw)
                        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
                        const ext = name.split('.').pop().toLowerCase()
                        const mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', pdf:'application/pdf' }
                        const blob = new Blob([bytes], { type: mimeMap[ext] || 'application/octet-stream' })
                        const url = URL.createObjectURL(blob)
                        const link = document.createElement('a')
                        link.href = url
                        link.download = name
                        link.click()
                        URL.revokeObjectURL(url)
                      }
                    } catch (err) {
                      alert(`Failed to load file: ${err.message}`)
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-surface-low rounded-lg text-xs text-primary hover:shadow-card transition-all cursor-pointer"
                >
                  <FileIcon className="w-3.5 h-3.5" />
                  {a.name}
                </button>
              ))}
            </div>
          )}

          {/* Reactions display */}
          {reactionEntries.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {reactionEntries.map(([emoji, users]) => {
                const iReacted = users.includes(me)
                return (
                  <button
                    key={emoji}
                    onClick={() => toggleReaction(msg, emoji)}
                    title={users.join(', ')}
                    className={`inline-flex items-center gap-1 bg-surface-low rounded-full px-2 py-0.5 text-xs cursor-pointer transition-all hover:shadow-card ${
                      iReacted ? 'ring-1 ring-primary/40' : ''
                    }`}
                  >
                    <span>{emoji}</span>
                    <span className="text-on-surface-dim">{users.length}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Action bar (hover) */}
          <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Reaction picker trigger */}
            <div className="relative">
              <button
                onClick={() => setReactionPickerMsg(reactionPickerMsg === msg.id ? null : msg.id)}
                className="text-on-surface-dim hover:text-on-surface text-xs cursor-pointer px-1 py-0.5 rounded hover:bg-surface-low"
                title="Add reaction"
              >
                +
              </button>
              {reactionPickerMsg === msg.id && (
                <div className="absolute bottom-full left-0 mb-1 bg-surface-card rounded-xl shadow-float p-2 z-20 flex gap-1">
                  {REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => toggleReaction(msg, emoji)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-low cursor-pointer text-base"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Reply button */}
            <button
              onClick={() => {
                setExpandedThread(isExpanded ? null : msg.id)
                setThreadReplyBody('')
              }}
              className="text-on-surface-dim hover:text-on-surface text-xs cursor-pointer px-1 py-0.5 rounded hover:bg-surface-low"
            >
              Reply{replyCount > 0 ? ` (${replyCount})` : ''}
            </button>
          </div>

          {/* Reply count indicator (always visible if there are replies) */}
          {replyCount > 0 && !isExpanded && (
            <button
              onClick={() => {
                setExpandedThread(msg.id)
                setThreadReplyBody('')
              }}
              className="mt-2 text-xs text-primary hover:underline cursor-pointer"
            >
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </button>
          )}

          {/* Thread expansion */}
          {isExpanded && (
            <div className="mt-3 border-l-2 border-primary/20 pl-4 ml-1">
              {replies.map((reply) => (
                <div key={reply.id} className="mb-2 flex items-start gap-2">
                  <img src={`https://github.com/${reply.author}.png?size=32`} alt=""
                    className="w-6 h-6 rounded-full shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-xs font-medium text-on-surface">{reply.author}</span>
                      <span className="text-[10px] text-on-surface-dim">{formatTime(reply.createdAt)}</span>
                    </div>
                    <p className="text-xs text-on-surface-variant whitespace-pre-wrap">{renderBody(reply.body, taskList, navigate)}</p>
                  </div>
                </div>
              ))}
              {/* Thread compose */}
              <div className="bg-surface-low rounded-lg p-2 flex gap-2 mt-1">
                <input
                  type="text"
                  value={threadReplyBody}
                  onChange={(e) => setThreadReplyBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleThreadReply(msg)
                    }
                  }}
                  placeholder="Write a reply..."
                  className="flex-1 text-xs bg-transparent border-0 focus:outline-none text-on-surface placeholder:text-on-surface-dim"
                />
                <button
                  onClick={() => handleThreadReply(msg)}
                  disabled={threadPosting || !threadReplyBody.trim()}
                  className="px-2 py-0.5 text-[10px] gradient-primary text-white rounded-full disabled:opacity-50 cursor-pointer shrink-0"
                >
                  {threadPosting ? '...' : 'Send'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Pin Icon SVG ──

function PinIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  )
}

function FileIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  )
}

function TrashIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  )
}

function renderBody(text, taskList, onNavigate) {
  const taskNames = (taskList || []).map((t) => t.title.toLowerCase())
  return text.split(/([@#]\S+)/g).map((part, i) => {
    if (part.startsWith('@'))
      return <span key={i} className="text-primary font-medium">{part}</span>
    if (part.startsWith('#')) {
      const refName = part.slice(1)
      const exists = taskNames.includes(refName.toLowerCase())
      if (!exists && taskList) {
        return <span key={i} className="bg-red-50 text-red-400 line-through rounded px-1.5 py-0.5 text-xs font-medium" title="Task deleted">{part}</span>
      }
      return (
        <span
          key={i}
          className="bg-primary-surface text-primary rounded px-1.5 py-0.5 text-xs font-medium cursor-pointer hover:underline"
          onClick={(e) => { e.stopPropagation(); onNavigate?.('/board') }}
        >
          {part}
        </span>
      )
    }
    return part
  })
}

function statusDotColor(status) {
  switch (status) {
    case 'doing': return 'bg-blue-500'
    case 'done': return 'bg-emerald-500'
    case 'blocked': return 'bg-red-500'
    default: return 'bg-gray-400'
  }
}

function formatTime(iso) {
  const d = new Date(iso)
  const now = new Date()
  const diff = now - d
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return d.toLocaleDateString()
}
