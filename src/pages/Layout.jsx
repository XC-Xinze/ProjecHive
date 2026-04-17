import { useEffect, useRef, useState, useCallback } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { loadMessages, listGitSyncRepos, getConfig, isRepoInitialized, initializeRepo, listDirectory, getFileContent, getLatestCommitSha } from '../services/github'

const navItems = [
  { to: '/', label: 'Overview', icon: HomeIcon },
  { to: '/board', label: 'Board', icon: BoardIcon },
  { to: '/tasks', label: 'Tasks', icon: TaskListIcon },
  { to: '/timeline', label: 'Timeline', icon: TimelineIcon },
  { to: '/roadmap', label: 'Roadmap', icon: RoadmapIcon },
  { to: '/members', label: 'Members', icon: MembersIcon },
  { to: '/docs', label: 'Docs', icon: DocsIcon },
  { to: '/messages', label: 'Messages', icon: MessagesIcon, badge: true },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

export default function Layout() {
  const {
    owner, repo, token, currentUser,
    selectProject, clearProject,
    lastMsgRead, setUnreadCount, unreadCount,
    notifications, setNotifications, readNotifIds, markNotifRead, clearAllNotifs,
  } = useStore()
  const navigate = useNavigate()
  const pollRef = useRef(null)
  const me = currentUser?.login

  // Project switcher
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [projects, setProjects] = useState([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const switcherRef = useRef(null)

  // Notification panel
  const [showNotifs, setShowNotifs] = useState(false)
  const notifRef = useRef(null)

  // Sync animation + remote update detection
  const shaKey = `projecthive-sha-${owner}-${repo}`
  const syncFlagKey = 'projecthive-syncing'
  const [syncing, setSyncing] = useState(() =>
    typeof sessionStorage !== 'undefined' && sessionStorage.getItem(syncFlagKey) === '1'
  )
  const [pendingUpdate, setPendingUpdate] = useState(false)
  const lastSeenShaRef = useRef(
    typeof localStorage !== 'undefined' ? localStorage.getItem(shaKey) : null
  )

  // ── Derive notifications from messages + tasks ──
  const deriveNotifications = useCallback((msgs, tasks) => {
    const notifs = []

    // @mentions in messages (from others)
    for (const m of msgs) {
      if (m.author === me) continue
      const mentioned = m.mentions?.includes(me) || m.body?.includes(`@${me}`)
      if (mentioned) {
        notifs.push({
          id: `mention-${m.id}`,
          type: 'mention',
          title: `${m.author} mentioned you`,
          body: m.body?.slice(0, 80),
          createdAt: m.createdAt,
          route: '/messages',
        })
      }
    }

    // Tasks assigned to me
    for (const t of tasks) {
      if (t.assignee !== me) continue
      notifs.push({
        id: `task-${t.id}`,
        type: 'task',
        title: `Task assigned: ${t.title}`,
        body: t.status === 'done' ? 'Completed' : t.dueDate ? `Due ${new Date(t.dueDate).toLocaleDateString()}` : '',
        createdAt: t.createdAt,
        route: '/tasks',
      })
    }

    // Sort newest first, limit to 10
    notifs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    return notifs.slice(0, 20)
  }, [me])

  // ── Poll for messages + tasks (unread count + notifications + remote SHA) ──
  useEffect(() => {
    async function poll() {
      try {
        const [msgs, taskFiles, latestSha] = await Promise.all([
          loadMessages(owner, repo),
          loadTasks(owner, repo),
          getLatestCommitSha(owner, repo),
        ])

        // Unread message count
        const unread = msgs.filter((m) => new Date(m.createdAt).getTime() > lastMsgRead).length
        setUnreadCount(unread)

        // Notifications
        if (me) {
          const notifs = deriveNotifications(msgs, taskFiles)
          setNotifications(notifs)
        }

        // Remote update detection
        if (latestSha) {
          const seen = lastSeenShaRef.current
          if (!seen) {
            // First successful poll — record baseline silently
            lastSeenShaRef.current = latestSha
            localStorage.setItem(shaKey, latestSha)
          } else if (seen !== latestSha) {
            setPendingUpdate(true)
          }
          // If we just finished a sync, clear the overlay flag once data lands
          if (sessionStorage.getItem(syncFlagKey) === '1') {
            sessionStorage.removeItem(syncFlagKey)
            setSyncing(false)
          }
        }
      } catch {}
    }

    if (owner && repo) {
      poll()
      pollRef.current = setInterval(poll, 30000)
      return () => clearInterval(pollRef.current)
    }
  }, [owner, repo, lastMsgRead, me, shaKey])

  // Close panels on outside click
  useEffect(() => {
    function handleClick(e) {
      if (switcherRef.current && !switcherRef.current.contains(e.target)) setShowSwitcher(false)
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifs(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function toggleSwitcher() {
    if (showSwitcher) { setShowSwitcher(false); return }
    setShowSwitcher(true)
    setLoadingProjects(true)
    try {
      const repos = await listGitSyncRepos(token)
      const enriched = await Promise.all(repos.map(async (r) => {
        try {
          const { config } = await getConfig(r.owner.login, r.name)
          return { ...r, _projectName: config?.name, _initialized: true }
        } catch {
          return { ...r, _projectName: null, _initialized: false }
        }
      }))
      setProjects(enriched)
    } catch {}
    setLoadingProjects(false)
  }

  async function switchTo(r) {
    if (!r._initialized) {
      try {
        const name = r.name.replace(/^gitsync-/i, '').replace(/-/g, ' ')
        await initializeRepo(r.owner.login, r.name, name, '')
      } catch { return }
    }
    selectProject(r.owner.login, r.name)
    setShowSwitcher(false)
    navigate('/')
  }

  async function handleSync() {
    setSyncing(true)
    setPendingUpdate(false)
    sessionStorage.setItem(syncFlagKey, '1')
    // Capture the latest remote SHA before reload so the post-reload poll
    // recognizes the current state as "seen" instead of flagging it again.
    try {
      const latest = await getLatestCommitSha(owner, repo)
      if (latest) {
        lastSeenShaRef.current = latest
        localStorage.setItem(shaKey, latest)
      }
    } catch {}
    // Give GitHub a moment to propagate before reloading.
    setTimeout(() => window.location.reload(), 1500)
  }

  const unreadNotifCount = notifications.filter((n) => !readNotifIds.includes(n.id)).length

  return (
    <div className="h-screen bg-surface flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-surface-low flex flex-col shrink-0 h-full">
        {/* macOS drag region */}
        <div className="h-8 shrink-0" style={{ WebkitAppRegion: 'drag' }} />

        {/* Project header */}
        <div className="relative mx-3 mb-3" ref={switcherRef}>
          <button
            onClick={toggleSwitcher}
            className="w-full px-3 py-2.5 text-left rounded-xl hover:bg-surface transition-colors cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 gradient-primary text-white rounded-lg flex items-center justify-center text-xs font-bold shrink-0">
                {repo.replace(/^gitsync-/i, '')[0]?.toUpperCase() || 'P'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-on-surface truncate">
                  {repo.replace(/^gitsync-/i, '')}
                </p>
                <p className="text-[11px] text-on-surface-dim truncate">{owner}/{repo}</p>
              </div>
              <svg className={`w-3.5 h-3.5 text-on-surface-dim group-hover:text-on-surface-variant shrink-0 transition-all ${showSwitcher ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </div>
          </button>

          {showSwitcher && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-surface-card rounded-xl shadow-float z-50 overflow-hidden">
              {loadingProjects ? (
                <div className="px-3 py-4 text-xs text-on-surface-dim text-center animate-pulse">Loading projects...</div>
              ) : projects.length > 0 ? (
                <div className="max-h-64 overflow-y-auto py-1">
                  {projects.map((r) => {
                    const isCurrent = r.owner.login === owner && r.name === repo
                    return (
                      <button
                        key={r.id}
                        onClick={() => !isCurrent && switchTo(r)}
                        className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
                          isCurrent ? 'bg-primary-surface cursor-default' : 'hover:bg-surface cursor-pointer'
                        }`}
                      >
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 ${
                          isCurrent ? 'gradient-primary text-white' : 'bg-surface text-on-surface-variant'
                        }`}>
                          {r.name.replace(/^gitsync-/i, '')[0]?.toUpperCase() || 'P'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs truncate ${isCurrent ? 'font-semibold text-on-surface' : 'text-on-surface-variant'}`}>
                            {r._projectName || r.name.replace(/^gitsync-/i, '')}
                          </p>
                          <p className="text-[10px] text-on-surface-dim truncate">{r.owner.login}/{r.name}</p>
                        </div>
                        {isCurrent && <span className="text-[10px] text-primary font-medium shrink-0">Current</span>}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="px-3 py-4 text-xs text-on-surface-dim text-center">No projects found</div>
              )}
              <div className="px-3 py-2">
                <button
                  onClick={() => { setShowSwitcher(false); clearProject(); navigate('/projects') }}
                  className="w-full text-left text-xs text-on-surface-variant hover:text-on-surface cursor-pointer py-1"
                >
                  Manage Projects...
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Notification bell + New Task */}
        <div className="px-3 mb-4 flex items-center gap-2">
          <button
            onClick={() => navigate('/board')}
            className="flex-1 gradient-primary text-white rounded-full px-4 py-2 text-sm font-semibold cursor-pointer hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Task
          </button>
          {/* Notification bell */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setShowNotifs(!showNotifs)}
              className="relative p-2 rounded-xl hover:bg-surface transition-colors cursor-pointer"
            >
              <BellIcon />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 gradient-primary text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                  {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                </span>
              )}
            </button>

            {/* Notification dropdown */}
            {showNotifs && (
              <div className="absolute left-0 top-full mt-1 w-80 bg-surface-card rounded-xl shadow-float overflow-hidden z-50">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm font-semibold text-on-surface">Notifications</span>
                  {unreadNotifCount > 0 && (
                    <button
                      onClick={() => clearAllNotifs()}
                      className="text-[10px] text-primary hover:underline cursor-pointer"
                    >
                      Mark all read
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto">
                  {notifications.length > 0 ? (
                    notifications.slice(0, 10).map((n) => {
                      const isRead = readNotifIds.includes(n.id)
                      return (
                        <button
                          key={n.id}
                          onClick={() => {
                            if (!isRead) markNotifRead(n.id)
                            setShowNotifs(false)
                            navigate(n.route)
                          }}
                          className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer hover:bg-surface ${
                            isRead ? 'opacity-60' : ''
                          }`}
                        >
                          <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${isRead ? 'bg-transparent' : 'gradient-primary'}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={`text-xs font-medium truncate ${isRead ? 'text-on-surface-dim' : 'text-on-surface'}`}>
                                {n.title}
                              </span>
                              <NotifTypeIcon type={n.type} />
                            </div>
                            {n.body && <p className="text-[11px] text-on-surface-dim truncate">{n.body}</p>}
                            <p className="text-[10px] text-on-surface-dim mt-0.5">{formatTimeAgo(n.createdAt)}</p>
                          </div>
                        </button>
                      )
                    })
                  ) : (
                    <div className="px-4 py-8 text-center text-on-surface-dim text-xs">No notifications</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 px-1 space-y-0.5 overflow-y-auto">
          {navItems.map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `relative flex items-center gap-2.5 px-5 py-2 text-sm transition-colors rounded-lg ${
                  isActive ? 'text-primary font-semibold' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-full bg-primary" />}
                  <Icon />
                  {label}
                  {badge && unreadCount > 0 && (
                    <span className="ml-auto px-1.5 py-0.5 gradient-primary text-white text-[10px] font-medium rounded-full leading-none">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Sync */}
        <div className="px-3 pb-4 pt-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="relative w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-on-surface-dim hover:text-on-surface-variant hover:bg-surface rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            <span className={syncing ? 'animate-spin' : ''}><RefreshIcon /></span>
            {syncing ? 'Syncing...' : pendingUpdate ? 'Updates available' : 'Sync'}
            {pendingUpdate && !syncing && (
              <span className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-emerald-500" />
            )}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto relative">
        <Outlet />
        {syncing && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-surface/70 backdrop-blur-sm pointer-events-none">
            <div className="flex items-center gap-3 px-5 py-3 bg-surface-card rounded-xl shadow-float">
              <span className="animate-spin"><RefreshIcon /></span>
              <span className="text-sm text-on-surface">Syncing… waiting for GitHub</span>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

// ── Helper: load tasks ──
async function loadTasks(owner, repo) {
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

function formatTimeAgo(iso) {
  const d = new Date(iso)
  const now = new Date()
  const mins = Math.floor((now - d) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}

function NotifTypeIcon({ type }) {
  if (type === 'mention') return (
    <span className="px-1 py-0.5 text-[8px] rounded bg-blue-100 text-blue-600 font-medium shrink-0">@</span>
  )
  return (
    <span className="px-1 py-0.5 text-[8px] rounded bg-emerald-100 text-emerald-600 font-medium shrink-0">task</span>
  )
}

// ── Icons ──

function BellIcon() {
  return (
    <svg className="w-4.5 h-4.5 text-on-surface-variant" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
    </svg>
  )
}

function HomeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955a1.126 1.126 0 0 1 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  )
}

function TaskListIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
    </svg>
  )
}

function BoardIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125Z" />
    </svg>
  )
}

function TimelineIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

function MembersIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M21.015 4.356v4.992" />
    </svg>
  )
}

function DocsIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  )
}

function RoadmapIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
    </svg>
  )
}

function MessagesIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  )
}
