import { create } from 'zustand'

const AUTH_KEY = 'gitsync-auth'
const PROJECT_KEY = 'gitsync-project'
const READ_KEY = 'gitsync-msg-read' // timestamp of last read messages
const THEME_KEY = 'gitsync-theme'
const NOTIF_READ_KEY = 'gitsync-notif-read'

function loadReadNotifs() {
  try { return JSON.parse(localStorage.getItem(NOTIF_READ_KEY)) || [] } catch { return [] }
}

function loadAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)) } catch { return null }
}
function loadUser() {
  try { return JSON.parse(localStorage.getItem('gitsync-user')) } catch { return null }
}
function loadProject() {
  try { return JSON.parse(localStorage.getItem(PROJECT_KEY)) } catch { return null }
}

export const useStore = create((set) => ({
  // Auth
  token: loadAuth()?.token || '',
  isLoggedIn: !!loadAuth()?.token,

  login: (token) => {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token }))
    set({ token, isLoggedIn: true })
  },
  logout: () => {
    localStorage.removeItem(AUTH_KEY)
    localStorage.removeItem(PROJECT_KEY)
    localStorage.removeItem('gitsync-user')
    set({ token: '', isLoggedIn: false, owner: '', repo: '', currentUser: null })
  },

  // Current GitHub user
  currentUser: loadUser(),
  setCurrentUser: (user) => {
    localStorage.setItem('gitsync-user', JSON.stringify(user))
    set({ currentUser: user })
  },

  // Current project
  owner: loadProject()?.owner || '',
  repo: loadProject()?.repo || '',

  selectProject: (owner, repo) => {
    localStorage.setItem(PROJECT_KEY, JSON.stringify({ owner, repo }))
    set({ owner, repo })
  },
  clearProject: () => {
    localStorage.removeItem(PROJECT_KEY)
    set({ owner: '', repo: '' })
  },

  // Theme
  theme: localStorage.getItem(THEME_KEY) || 'serene',
  setTheme: (id) => {
    localStorage.setItem(THEME_KEY, id)
    set({ theme: id })
  },

  // Message read tracking
  lastMsgRead: parseInt(localStorage.getItem(READ_KEY) || '0', 10),
  markMsgRead: () => {
    const now = Date.now()
    localStorage.setItem(READ_KEY, String(now))
    set({ lastMsgRead: now })
  },
  unreadCount: 0,
  setUnreadCount: (n) => set({ unreadCount: n }),

  // Notifications
  notifications: [],
  setNotifications: (list) => set({ notifications: list }),
  readNotifIds: loadReadNotifs(),
  markNotifRead: (id) => set((state) => {
    const ids = [...state.readNotifIds, id]
    localStorage.setItem(NOTIF_READ_KEY, JSON.stringify(ids))
    return { readNotifIds: ids }
  }),
  clearAllNotifs: () => {
    set((state) => {
      const ids = state.notifications.map((n) => n.id)
      localStorage.setItem(NOTIF_READ_KEY, JSON.stringify(ids))
      return { readNotifIds: ids }
    })
  },

  // Sync trigger — increment to tell pages to re-fetch
  syncKey: 0,
  triggerSync: () => set((state) => ({ syncKey: state.syncKey + 1 })),

  // Latest commit SHA produced by THIS client. Used by Layout to suppress the
  // "Updates available" badge for our own commits.
  lastSelfCommitSha: '',
  markSelfCommit: (sha) => {
    if (!sha) return
    set({ lastSelfCommitSha: sha })
  },

  // Per-project entity cache. Pages prefer this over a fresh remote fetch so
  // GitHub's eventual-consistency lag (especially during write storms on Board)
  // can't flash empty state on Timeline/Roadmap/Overview/etc.
  // Shape: { [`${owner}/${repo}`]: { tasks, messages, topics, docs, commits } }
  entityCache: {},
  getCached: (owner, repo, kind) => {
    if (!owner || !repo) return null
    return useStore.getState().entityCache[`${owner}/${repo}`]?.[kind] ?? null
  },
  setCached: (owner, repo, kind, items) => set((state) => {
    if (!owner || !repo) return state
    const key = `${owner}/${repo}`
    return {
      entityCache: {
        ...state.entityCache,
        [key]: { ...(state.entityCache[key] || {}), [kind]: items },
      },
    }
  }),

  // Items created locally but not yet confirmed by a remote refetch. Keeps the
  // optimistic record alive across page navigation + GitHub propagation lag,
  // so newly-created tasks/messages/docs don't briefly disappear.
  // Shape: { [kind]: { [id]: { item, createdAt } } }
  pendingWrites: {},
  addPendingWrite: (kind, item) => set((state) => {
    if (!item?.id) return state
    const bucket = { ...(state.pendingWrites[kind] || {}) }
    bucket[item.id] = { item, createdAt: Date.now() }
    return { pendingWrites: { ...state.pendingWrites, [kind]: bucket } }
  }),
  removePendingWrite: (kind, id) => set((state) => {
    const bucket = state.pendingWrites[kind]
    if (!bucket || !bucket[id]) return state
    const next = { ...bucket }
    delete next[id]
    return { pendingWrites: { ...state.pendingWrites, [kind]: next } }
  }),
  // Merge a list of pending items of a given kind into a freshly-loaded list.
  // Drops any pending entry that already appears remotely (confirmed) or that
  // is older than 5 minutes (assume failed write or someone else deleted it).
  mergePending: (kind, remoteList) => {
    const bucket = useStore.getState().pendingWrites[kind] || {}
    const remoteIds = new Set(remoteList.map((r) => r?.id).filter(Boolean))
    const now = Date.now()
    const TTL = 5 * 60 * 1000
    const survivors = []
    const toRemove = []
    for (const [id, { item, createdAt }] of Object.entries(bucket)) {
      if (remoteIds.has(id) || now - createdAt > TTL) {
        toRemove.push(id)
      } else {
        survivors.push(item)
      }
    }
    if (toRemove.length > 0) {
      set((state) => {
        const next = { ...(state.pendingWrites[kind] || {}) }
        toRemove.forEach((id) => delete next[id])
        return { pendingWrites: { ...state.pendingWrites, [kind]: next } }
      })
    }
    return survivors
  },
}))
