import { useEffect, useState, useCallback } from 'react'
import { useStore } from '../store'
import { listDirectory, getFileContent, updateFile } from '../services/github'

const STATUS_DOT = {
  todo: 'bg-gray-400',
  doing: 'bg-blue-500',
  done: 'bg-emerald-500',
  blocked: 'bg-red-500',
}

const STATUS_LABEL = {
  todo: 'Todo',
  doing: 'In Progress',
  done: 'Done',
  blocked: 'Blocked',
}

const SORT_OPTIONS = [
  { key: 'created', label: 'Created' },
  { key: 'due', label: 'Due Date' },
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Assignee' },
]

const STATUS_ORDER = { blocked: 0, doing: 1, todo: 2, done: 3 }

export default function TaskList() {
  const { owner, repo } = useStore()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState('created')
  const [sortAsc, setSortAsc] = useState(false)
  const [filterStatus, setFilterStatus] = useState(null)
  const [search, setSearch] = useState('')

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const files = await listDirectory(owner, repo, 'tasks')
      const jsonFiles = files.filter((f) => f.name.endsWith('.json'))
      const loaded = await Promise.all(
        jsonFiles.map(async (f) => {
          const { content } = await getFileContent(owner, repo, f.path)
          return JSON.parse(content)
        })
      )
      setTasks(loaded)
    } catch {
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [owner, repo])

  useEffect(() => { loadTasks() }, [loadTasks])

  async function changeStatus(task, newStatus) {
    if (task.status === newStatus) return
    // Optimistic update
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: newStatus } : t))
    try {
      const { content, sha } = await getFileContent(owner, repo, `tasks/${task.id}.json`)
      const latest = JSON.parse(content)
      latest.status = newStatus
      await updateFile(owner, repo, `tasks/${task.id}.json`, JSON.stringify(latest, null, 2), `[task] Move "${task.title}" → ${newStatus}`, sha)
    } catch (err) {
      loadTasks() // rollback
    }
  }

  function toggleSort(key) {
    if (sortBy === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortBy(key)
      setSortAsc(key === 'due') // due date ascending by default (soonest first)
    }
  }

  // Filter
  let filtered = tasks
  if (filterStatus) {
    filtered = filtered.filter((t) => t.status === filterStatus)
  }
  if (search.trim()) {
    const q = search.trim().toLowerCase()
    filtered = filtered.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.assignee?.toLowerCase().includes(q) ||
        t.labels?.some((l) => l.toLowerCase().includes(q))
    )
  }

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    switch (sortBy) {
      case 'created':
        cmp = new Date(b.createdAt) - new Date(a.createdAt)
        break
      case 'due':
        // Tasks without due date go to the end
        if (!a.dueDate && !b.dueDate) cmp = 0
        else if (!a.dueDate) cmp = 1
        else if (!b.dueDate) cmp = -1
        else cmp = new Date(a.dueDate) - new Date(b.dueDate)
        break
      case 'status':
        cmp = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
        break
      case 'assignee':
        cmp = (a.assignee || 'zzz').localeCompare(b.assignee || 'zzz')
        break
    }
    return sortAsc ? cmp : -cmp
  })

  // Stats
  const total = tasks.length
  const done = tasks.filter((t) => t.status === 'done').length
  const active = tasks.filter((t) => t.status !== 'done').length
  const overdue = tasks.filter(
    (t) => t.dueDate && t.status !== 'done' && new Date(t.dueDate) < new Date()
  ).length

  if (loading) {
    return (
      <div className="p-10">
        <div className="h-8 w-48 bg-surface-low rounded-xl animate-pulse mb-6" />
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-12 bg-surface-low rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-10 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display font-bold text-xl text-on-surface">All Tasks</h2>
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-dim" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              className="pl-9 pr-3 py-1.5 bg-surface-low rounded-full text-xs text-on-surface w-48 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] placeholder:text-on-surface-dim"
            />
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <MiniStat label="Total" value={total} color="var(--color-primary)" />
        <MiniStat label="Active" value={active} color="#4456ba" />
        <MiniStat label="Done" value={done} color="#10b981" />
        <MiniStat label="Overdue" value={overdue} color="#ef4444" />
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setFilterStatus(null)}
          className={`px-3 py-1 text-xs rounded-full cursor-pointer transition-all ${
            !filterStatus ? 'gradient-primary text-white' : 'bg-surface-card text-on-surface-variant shadow-card'
          }`}
        >
          All
        </button>
        {Object.entries(STATUS_LABEL).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilterStatus(filterStatus === key ? null : key)}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-full cursor-pointer transition-all ${
              filterStatus === key ? 'gradient-primary text-white' : 'bg-surface-card text-on-surface-variant shadow-card'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${filterStatus === key ? 'bg-white' : STATUS_DOT[key]}`} />
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-surface-card rounded-2xl shadow-card overflow-hidden">
        {/* Header */}
        <div className="grid items-center text-xs text-on-surface-dim font-medium px-5 py-3"
          style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr' }}
        >
          <SortHeader label="Task" sortKey="created" current={sortBy} asc={sortAsc} onSort={toggleSort} />
          <SortHeader label="Status" sortKey="status" current={sortBy} asc={sortAsc} onSort={toggleSort} />
          <SortHeader label="Assignee" sortKey="assignee" current={sortBy} asc={sortAsc} onSort={toggleSort} />
          <SortHeader label="Due Date" sortKey="due" current={sortBy} asc={sortAsc} onSort={toggleSort} />
          <span>Created</span>
        </div>

        {/* Rows */}
        {sorted.length > 0 ? (
          <div>
            {sorted.map((task) => {
              const overdue = task.dueDate && task.status !== 'done' && new Date(task.dueDate) < new Date()
              return (
                <div
                  key={task.id}
                  className="grid items-center px-5 py-3 hover:bg-surface transition-colors"
                  style={{
                    gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
                    borderTop: '1px solid var(--color-surface-low)',
                  }}
                >
                  {/* Title + labels */}
                  <div className="min-w-0 pr-4">
                    <p className={`text-sm font-medium truncate ${task.status === 'done' ? 'text-on-surface-dim line-through' : 'text-on-surface'}`}>
                      {task.title}
                    </p>
                    {task.labels?.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {task.labels.map((l) => (
                          <span key={l} className="px-1.5 py-0.5 bg-primary-surface text-primary rounded text-[10px] font-medium">{l}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Status — clickable dropdown */}
                  <div className="relative">
                    <select
                      value={task.status}
                      onChange={(e) => changeStatus(task, e.target.value)}
                      className="appearance-none bg-transparent text-xs text-on-surface-variant cursor-pointer pr-5 py-0.5 focus:outline-none hover:text-on-surface"
                      style={{ backgroundImage: 'none' }}
                    >
                      {Object.entries(STATUS_LABEL).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                    <span className={`absolute left-[-12px] top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${STATUS_DOT[task.status]} pointer-events-none`} />
                  </div>

                  {/* Assignee */}
                  <div className="flex items-center gap-2">
                    {task.assignee ? (
                      <>
                        <img
                          src={`https://github.com/${task.assignee}.png?size=24`}
                          alt=""
                          className="w-5 h-5 rounded-full"
                        />
                        <span className="text-xs text-on-surface-variant truncate">{task.assignee}</span>
                      </>
                    ) : (
                      <span className="text-xs text-on-surface-dim">—</span>
                    )}
                  </div>

                  {/* Due date */}
                  <div>
                    {task.dueDate ? (
                      <span className={`text-xs ${overdue ? 'text-red-500 font-medium' : 'text-on-surface-variant'}`}>
                        {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    ) : (
                      <span className="text-xs text-on-surface-dim">—</span>
                    )}
                  </div>

                  {/* Created */}
                  <div>
                    <span className="text-xs text-on-surface-dim">
                      {new Date(task.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="px-5 py-12 text-center text-on-surface-dim text-sm">
            {tasks.length === 0 ? 'No tasks yet.' : 'No tasks match the current filter.'}
          </div>
        )}
      </div>
    </div>
  )
}

function SortHeader({ label, sortKey, current, asc, onSort }) {
  const isActive = current === sortKey
  return (
    <button
      onClick={() => onSort(sortKey)}
      className="flex items-center gap-1 cursor-pointer hover:text-on-surface transition-colors text-left"
    >
      {label}
      {isActive && (
        <svg className={`w-3 h-3 transition-transform ${asc ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
        </svg>
      )}
    </button>
  )
}

function MiniStat({ label, value, color }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-card px-4 py-3 flex items-center gap-3">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <div>
        <p className="text-lg font-display font-bold text-on-surface">{value}</p>
        <p className="text-[11px] text-on-surface-dim">{label}</p>
      </div>
    </div>
  )
}
