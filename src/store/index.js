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
}))
