import { useEffect, useState, useCallback, useRef } from 'react'
import { useStore } from '../store'
import { getCommits, getCommitDetail, updateFile, getFileContent, deleteCommitFromHistory, getConfig, parseRepoUrl } from '../services/github'
import { parseCommitMessage, COMMIT_KEYWORDS } from '../services/template'

const POLL_INTERVAL = 30000 // 30s auto-refresh

export default function Timeline() {
  const { owner, repo, getCached, setCached } = useStore()
  const [viewMode, setViewMode] = useState('project') // 'project' | 'code'
  const [codeRepos, setCodeRepos] = useState([]) // [{ owner, repo, url }]
  const [selectedCodeRepo, setSelectedCodeRepo] = useState(null) // index
  const [commits, setCommits] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedSha, setExpandedSha] = useState(null)
  const [details, setDetails] = useState({})
  const [filterUser, setFilterUser] = useState(null)
  const [filterKeyword, setFilterKeyword] = useState(null)
  const [hideSystem, setHideSystem] = useState(true)
  const [showCompose, setShowCompose] = useState(false)
  const [deletingSha, setDeletingSha] = useState(null)
  const pollRef = useRef(null)

  // Resolve which repo we're reading commits from based on viewMode
  const activeRepo =
    viewMode === 'code' && codeRepos[selectedCodeRepo]
      ? codeRepos[selectedCodeRepo]
      : { owner, repo }

  // Load linked code repos from the project config once
  useEffect(() => {
    let cancelled = false
    getConfig(owner, repo).then(({ config }) => {
      if (cancelled || !config) return
      const urls = []
      if (config.codeRepo) urls.push(config.codeRepo)
      if (config.codeRepos?.length) {
        config.codeRepos.forEach((u) => { if (u && !urls.includes(u)) urls.push(u) })
      }
      const parsed = urls.map((u) => ({ ...parseRepoUrl(u), url: u })).filter((p) => p.owner)
      setCodeRepos(parsed)
      if (parsed.length > 0) setSelectedCodeRepo(0)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [owner, repo])

  // silent=true means don't show loading skeleton (for refreshes)
  const loadCommits = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await getCommits(activeRepo.owner, activeRepo.repo, { perPage: 50 })
      setCommits(data)
      setCached(activeRepo.owner, activeRepo.repo, 'commits', data)
    } catch {
      // Leave existing commits in place — propagation lag from a write storm
      // shouldn't blank the timeline.
    }
    if (!silent) setLoading(false)
  }, [activeRepo.owner, activeRepo.repo, setCached])

  // Reload when active repo changes; poll for refreshes
  useEffect(() => {
    const cached = getCached(activeRepo.owner, activeRepo.repo, 'commits')
    if (cached) { setCommits(cached); setLoading(false) }
    else { setCommits([]); setLoading(true) }
    setDetails({})
    setExpandedSha(null)
    setFilterUser(null)
    setFilterKeyword(null)
    loadCommits(!!cached)  // background refresh if we already painted from cache
    pollRef.current = setInterval(() => loadCommits(true), POLL_INTERVAL)
    return () => clearInterval(pollRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCommits])

  async function toggleDetail(sha) {
    if (expandedSha === sha) {
      setExpandedSha(null)
      return
    }
    setExpandedSha(sha)
    if (!details[sha]) {
      const data = await getCommitDetail(activeRepo.owner, activeRepo.repo, sha)
      setDetails((prev) => ({ ...prev, [sha]: data }))
    }
  }

  async function handleDeleteCommit(sha, e) {
    e.stopPropagation()
    if (!confirm('Delete this commit from history?\n\nThis will force-push and rewrite git history. Other collaborators may need to re-pull.')) return
    setDeletingSha(sha)
    try {
      await deleteCommitFromHistory(owner, repo, sha)
      setCommits((prev) => prev.filter((c) => c.sha !== sha))
      setTimeout(() => loadCommits(true), 1000)
    } catch (err) {
      alert(`Failed to delete commit: ${err.message}`)
    } finally {
      setDeletingSha(null)
    }
  }

  // Unique authors
  const authors = [...new Map(
    commits.filter((c) => c.author).map((c) => [c.author.login, c.author])
  ).values()]

  // Keywords actually used
  const usedKeywords = [...new Set(
    commits.map((c) => parseCommitMessage(c.commit.message.split('\n')[0]).keyword).filter(Boolean)
  )]

  const isCodeView = viewMode === 'code'

  const filtered = commits.filter((c) => {
    const firstLine = c.commit.message.split('\n')[0]
    if (!isCodeView && hideSystem && isSystemCommit(firstLine)) return false
    if (filterUser && c.author?.login !== filterUser) return false
    if (!isCodeView && filterKeyword) {
      const { keyword } = parseCommitMessage(firstLine)
      if (keyword !== filterKeyword) return false
    }
    return true
  })

  if (loading) {
    return (
      <div className="p-8 max-w-4xl">
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-surface-low rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-on-surface font-display">Timeline</h2>
        {!isCodeView && (
          <button
            onClick={() => setShowCompose(!showCompose)}
            className="px-3 py-1.5 gradient-primary text-white text-sm rounded-full hover:opacity-90 transition-opacity cursor-pointer"
          >
            + New Post
          </button>
        )}
      </div>

      {/* View mode tabs */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setViewMode('project')}
          className={`px-3 py-1.5 text-xs rounded-full cursor-pointer transition-all ${
            !isCodeView ? 'gradient-primary text-white' : 'bg-surface-card text-on-surface-variant shadow-card hover:shadow-lifted'
          }`}
        >
          ProjectHive Activity
        </button>
        <button
          onClick={() => setViewMode('code')}
          disabled={codeRepos.length === 0}
          title={codeRepos.length === 0 ? 'No linked code repository' : ''}
          className={`px-3 py-1.5 text-xs rounded-full cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            isCodeView ? 'gradient-primary text-white' : 'bg-surface-card text-on-surface-variant shadow-card hover:shadow-lifted'
          }`}
        >
          Code Repo Activity
        </button>

        {/* Code repo selector — only when in code mode and >1 repo */}
        {isCodeView && codeRepos.length > 1 && (
          <>
            <span className="w-px h-5 bg-on-surface-dim/20 mx-1" />
            {codeRepos.map((r, i) => (
              <button
                key={r.url}
                onClick={() => setSelectedCodeRepo(i)}
                className={`px-2.5 py-1 text-[11px] rounded-full cursor-pointer transition-all font-mono ${
                  selectedCodeRepo === i
                    ? 'bg-primary-surface text-primary'
                    : 'bg-surface-card text-on-surface-dim'
                }`}
              >
                {r.owner}/{r.repo}
              </button>
            ))}
          </>
        )}
        {isCodeView && codeRepos[selectedCodeRepo] && (
          <a
            href={`https://github.com/${activeRepo.owner}/${activeRepo.repo}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (window.electronAPI?.openExternal) {
                e.preventDefault()
                window.electronAPI.openExternal(e.currentTarget.href)
              }
            }}
            className="ml-auto text-[11px] text-on-surface-dim hover:text-primary cursor-pointer"
          >
            View on GitHub →
          </a>
        )}
      </div>

      {showCompose && !isCodeView && (
        <ComposeBar
          owner={owner}
          repo={repo}
          onPosted={(commitMsg) => {
            setShowCompose(false)
            // Optimistic placeholder
            const pendingId = 'pending-' + Date.now()
            setCommits((prev) => [{
              sha: pendingId,
              commit: {
                message: commitMsg,
                author: { name: 'You', date: new Date().toISOString() },
              },
              author: null,
            }, ...prev])
            // Retry fetch until the new commit appears
            let retries = 0
            const tryRefresh = async () => {
              retries++
              await loadCommits(true)
              // If still showing placeholder after 5 retries, stop
              if (retries < 5) setTimeout(tryRefresh, 2000)
            }
            setTimeout(tryRefresh, 1500)
          }}
          onCancel={() => setShowCompose(false)}
        />
      )}

      {/* Filters */}
      <div className="space-y-3 mb-6">
        {/* System toggle — only meaningful in project view */}
        {!isCodeView && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-on-surface-dim w-14 shrink-0">Filter:</span>
            <button
              onClick={() => setHideSystem(!hideSystem)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors cursor-pointer ${
                hideSystem ? 'gradient-primary text-white' : 'bg-surface-card text-on-surface-variant shadow-card hover:shadow-lifted'
              }`}
            >
              Hide system activity
            </button>
          </div>
        )}

        {/* Author filter */}
        {authors.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-on-surface-dim w-14 shrink-0">Author:</span>
            <button
              onClick={() => setFilterUser(null)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors cursor-pointer ${
                !filterUser ? 'gradient-primary text-white' : 'bg-surface-card text-on-surface-variant shadow-card hover:shadow-lifted'
              }`}
            >
              All
            </button>
            {authors.map((a) => (
              <button
                key={a.login}
                onClick={() => setFilterUser(filterUser === a.login ? null : a.login)}
                className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-full transition-colors cursor-pointer ${
                  filterUser === a.login ? 'gradient-primary text-white' : 'bg-surface-card text-on-surface-variant shadow-card hover:shadow-lifted'
                }`}
              >
                <img src={a.avatar_url} alt="" className="w-4 h-4 rounded-full" />
                {a.login}
              </button>
            ))}
          </div>
        )}

        {/* Keyword filter — only meaningful in project view */}
        {!isCodeView && usedKeywords.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-on-surface-dim w-14 shrink-0">Type:</span>
            <button
              onClick={() => setFilterKeyword(null)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors cursor-pointer ${
                !filterKeyword ? 'gradient-primary text-white' : 'bg-surface-card text-on-surface-variant shadow-card hover:shadow-lifted'
              }`}
            >
              All
            </button>
            {usedKeywords.map((kw) => {
              const cfg = COMMIT_KEYWORDS[kw]
              return (
                <button
                  key={kw}
                  onClick={() => setFilterKeyword(filterKeyword === kw ? null : kw)}
                  className={`px-2.5 py-1 text-xs rounded-full transition-colors cursor-pointer ${
                    filterKeyword === kw ? 'gradient-primary text-white' : cfg?.color || 'bg-surface-card text-on-surface-variant shadow-card'
                  }`}
                >
                  [{kw}]
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="relative">
        <div className="absolute left-5 top-0 bottom-0 w-px" style={{ backgroundColor: 'var(--color-surface-highest)' }} />

        <div className="space-y-0">
          {filtered.map((commit) => {
            const firstLine = commit.commit.message.split('\n')[0]
            const { keyword, config: kwCfg, message } = parseCommitMessage(firstLine)
            const detail = details[commit.sha]
            const isExpanded = expandedSha === commit.sha
            const date = new Date(commit.commit.author.date)

            return (
              <div key={commit.sha} className="relative pl-12 pb-6">
                {/* Dot — colored by keyword */}
                <div
                  className={`absolute left-[13px] top-1.5 w-3.5 h-3.5 rounded-full border-2 ${
                    kwCfg
                      ? keywordDotColor(keyword)
                      : 'bg-white border-gray-300'
                  }`}
                />

                {/* Card */}
                <div
                  className="bg-surface-card rounded-xl shadow-card p-5 hover:shadow-lifted transition-shadow cursor-pointer group/card relative"
                  onClick={() => toggleDetail(commit.sha)}
                >
                  {/* Delete commit button — only in project view */}
                  {!isCodeView && !commit.sha.startsWith('pending-') && (
                    <button
                      onClick={(e) => handleDeleteCommit(commit.sha, e)}
                      disabled={deletingSha === commit.sha}
                      className="absolute top-3 right-3 p-1.5 rounded-lg text-on-surface-dim hover:text-red-500 opacity-0 group-hover/card:opacity-100 transition-all cursor-pointer disabled:opacity-50"
                      title="Delete this commit from history"
                    >
                      {deletingSha === commit.sha ? (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      )}
                    </button>
                  )}
                  <div className="flex items-start gap-3">
                    {commit.author && (
                      <img
                        src={commit.author.avatar_url}
                        alt={commit.author.login}
                        className="w-8 h-8 rounded-full shrink-0 mt-0.5"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      {/* Keyword badge + message */}
                      <div className="flex items-center gap-2">
                        {kwCfg && (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${kwCfg.color}`}>
                            {kwCfg.icon} {kwCfg.label}
                          </span>
                        )}
                        <p className="text-sm text-on-surface font-medium leading-snug truncate">
                          {message}
                        </p>
                      </div>

                      {/* Meta */}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-on-surface-variant">
                          {commit.commit.author.name}
                        </span>
                        <span className="text-xs text-on-surface-dim">·</span>
                        <span className="text-xs text-on-surface-dim">
                          {formatRelativeTime(date)}
                        </span>
                        <span className="text-xs text-on-surface-dim">·</span>
                        <span className="text-xs text-on-surface-dim font-mono">
                          {commit.sha.slice(0, 7)}
                        </span>
                      </div>

                      {/* Multi-line commit body */}
                      {commit.commit.message.split('\n').length > 1 && (
                        <p className="text-xs text-on-surface-dim mt-1 line-clamp-2">
                          {commit.commit.message.split('\n').slice(1).join(' ').trim()}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Expanded: changed files */}
                  {isExpanded && detail && (
                    <div className="mt-3 bg-surface-low rounded-lg p-3">
                      <p className="text-xs text-on-surface-dim mb-2">
                        {detail.stats?.total || 0} changes
                        <span className="text-green-600 ml-1">+{detail.stats?.additions || 0}</span>
                        <span className="text-red-500 ml-1">-{detail.stats?.deletions || 0}</span>
                      </p>
                      <div className="space-y-1">
                        {detail.files?.map((f) => (
                          <div key={f.filename} className="flex items-center gap-2 text-xs">
                            <StatusBadge status={f.status} />
                            <span className="text-on-surface-variant font-mono truncate">{f.filename}</span>
                            <span className="text-on-surface-dim ml-auto shrink-0">
                              <span className="text-green-600">+{f.additions}</span>{' '}
                              <span className="text-red-500">-{f.deletions}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {isExpanded && !detail && (
                    <div className="mt-3 bg-surface-low rounded-lg p-3 text-xs text-on-surface-dim animate-pulse">
                      Loading file changes...
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="text-on-surface-dim text-sm text-center py-12">
          {commits.length === 0 ? 'No commits yet.' : 'No commits match the current filter.'}
        </div>
      )}
    </div>
  )
}

// Detect auto-generated commits from Messages, Docs, Topics, and init.
// `[task]` is intentionally NOT here — task creates/moves/completions are
// meaningful project events the user wants visible even when system
// activity is hidden.
const SYSTEM_PATTERNS = [
  /^\[discuss\] /,                       // Messages: all message commits
  /^\[doc\] /,                           // Docs: share/init/delete
  /^\[attach\] /,                        // File uploads
  /^\[topic\] /,                         // Topics: open/archive/delete
  /^Initial commit$/,                    // GitHub auto-init
]

function isSystemCommit(firstLine) {
  return SYSTEM_PATTERNS.some((re) => re.test(firstLine))
}

function keywordDotColor(keyword) {
  const map = {
    update: 'bg-blue-400 border-blue-400',
    issue: 'bg-red-400 border-red-400',
    hold: 'bg-yellow-400 border-yellow-400',
    done: 'bg-green-400 border-green-400',
    task: 'bg-purple-400 border-purple-400',
    discuss: 'bg-orange-400 border-orange-400',
    doc: 'bg-teal-400 border-teal-400',
  }
  return map[keyword] || 'bg-gray-400 border-gray-400'
}

function StatusBadge({ status }) {
  const colors = {
    added: 'bg-green-100 text-green-700',
    modified: 'bg-yellow-100 text-yellow-700',
    removed: 'bg-red-100 text-red-700',
    renamed: 'bg-blue-100 text-blue-700',
  }
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
      {status?.[0]?.toUpperCase()}
    </span>
  )
}

function formatRelativeTime(date) {
  const now = new Date()
  const diffMs = now - date
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return date.toLocaleDateString()
}

// ── Compose Bar: pick keyword + write message → commit ──

function ComposeBar({ owner, repo, onPosted, onCancel }) {
  const [keyword, setKeyword] = useState('update')
  const [message, setMessage] = useState('')
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)

  async function handlePost(e) {
    e.preventDefault()
    if (!message.trim()) return
    setPosting(true)
    try {
      // We commit by appending to a timeline log file.
      // This creates a real commit with the keyword-tagged message.
      const logPath = `timeline/${new Date().toISOString().slice(0, 10)}.md`
      const commitMsg = `[${keyword}] ${message.trim()}`
      const timestamp = new Date().toISOString()
      const entry = `\n## ${timestamp}\n\n${message.trim()}${body.trim() ? '\n\n' + body.trim() : ''}\n`

      let existingContent = ''
      let sha = null
      try {
        const file = await getFileContent(owner, repo, logPath)
        existingContent = file.content
        sha = file.sha
      } catch {
        // File doesn't exist yet, will be created
      }

      await updateFile(owner, repo, logPath, existingContent + entry, commitMsg, sha)
      onPosted(commitMsg)
    } catch (err) {
      alert(`Post failed: ${err.message}`)
    } finally {
      setPosting(false)
    }
  }

  return (
    <form onSubmit={handlePost} className="bg-surface-card rounded-xl shadow-card p-5 mb-6">
      {/* Keyword picker */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {Object.entries(COMMIT_KEYWORDS).map(([key, cfg]) => (
          <button
            key={key}
            type="button"
            onClick={() => setKeyword(key)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
              keyword === key
                ? cfg.color + ' ring-2 ring-offset-1 ring-current'
                : 'bg-surface-low text-on-surface-dim hover:text-on-surface-variant'
            }`}
          >
            {cfg.icon} {cfg.label}
          </button>
        ))}
      </div>

      {/* Message input */}
      <input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="What's the update?"
        required
        autoFocus
        className="w-full px-3 py-2 bg-surface-low border-0 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] mb-2"
      />

      {/* Optional body */}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Details (optional)"
        rows={2}
        className="w-full px-3 py-2 bg-surface-low border-0 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] mb-3 resize-none"
      />

      {/* Preview + actions */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-on-surface-dim">
          Commit: <span className="font-mono text-on-surface-variant">[{keyword}] {message || '...'}</span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-on-surface-variant hover:bg-surface-low rounded-lg cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={posting || !message.trim()}
            className="px-4 py-1.5 gradient-primary text-white text-sm rounded-full hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
          >
            {posting ? 'Posting...' : 'Post'}
          </button>
        </div>
      </div>
    </form>
  )
}
