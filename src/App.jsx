import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store'
import { initOctokit, getCurrentUser, setOnCommit } from './services/github'
import { applyTheme } from './themes'
import Login from './pages/Login'
import ProjectList from './pages/ProjectList'
import Layout from './pages/Layout'
import Portal from './pages/Portal'
import Board from './pages/Board'
import Timeline from './pages/Timeline'
import Members from './pages/Members'
import Docs from './pages/Docs'
import Messages from './pages/Messages'
import Roadmap from './pages/Roadmap'
import TaskList from './pages/TaskList'
import Settings from './pages/Settings'

function RequireAuth({ children }) {
  const isLoggedIn = useStore((s) => s.isLoggedIn)
  if (!isLoggedIn) return <Navigate to="/login" replace />
  return children
}

function RequireProject({ children }) {
  const owner = useStore((s) => s.owner)
  if (!owner) return <Navigate to="/projects" replace />
  return children
}

export default function App() {
  const { token, isLoggedIn, setCurrentUser, theme } = useStore()

  // Apply theme on mount and when changed
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // Bridge github.js write callbacks → store, once.
  useEffect(() => {
    setOnCommit((sha) => useStore.getState().markSelfCommit(sha))
    return () => setOnCommit(null)
  }, [])

  useEffect(() => {
    if (isLoggedIn && token) {
      initOctokit(token)
      getCurrentUser().then(setCurrentUser).catch(() => {})
    }
  }, [isLoggedIn, token])

  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/projects" element={<RequireAuth><ProjectList /></RequireAuth>} />
        <Route
          element={
            <RequireAuth>
              <RequireProject>
                <Layout />
              </RequireProject>
            </RequireAuth>
          }
        >
          <Route path="/" element={<Portal />} />
          <Route path="/board" element={<Board />} />
          <Route path="/tasks" element={<TaskList />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/roadmap" element={<Roadmap />} />
          <Route path="/members" element={<Members />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
