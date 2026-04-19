import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore } from '../store'
import { listDirectory, getFileContent, updateFile, deleteFile, getCollaborators, loadMessages, loadTopics } from '../services/github'
import { TOPIC_CATEGORIES } from '../services/template'
import ConflictDialog from '../components/ConflictDialog'

const COLUMNS = [
  { id: 'todo', label: 'Todo', dot: 'bg-gray-400' },
  { id: 'doing', label: 'Doing', dot: 'bg-blue-500' },
  { id: 'done', label: 'Done', dot: 'bg-emerald-500' },
  { id: 'blocked', label: 'Blocked', dot: 'bg-red-500' },
]

function formatDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function isOverdue(dateStr) {
  if (!dateStr) return false
  const due = new Date(dateStr)
  due.setHours(23, 59, 59, 999)
  return due < new Date()
}

// Backward-compat: tasks may have legacy `assignee` (string) instead of `assignees` (array).
function getAssignees(task) {
  if (Array.isArray(task.assignees)) return task.assignees
  if (task.assignee) return [task.assignee]
  return []
}

function getCompletedBy(task) {
  return Array.isArray(task.completedBy) ? task.completedBy : []
}

function AssigneeStack({ task, size = 20, currentUser, onToggleMine }) {
  const assignees = getAssignees(task)
  const completed = new Set(getCompletedBy(task).filter((u) => assignees.includes(u)))
  const [burstKey, setBurstKey] = useState(0)
  const lastDoneRef = useRef(currentUser ? completed.has(currentUser.login) : false)
  const me = currentUser?.login

  // Trigger sparkle only when *I* just transitioned from undone → done.
  useEffect(() => {
    if (!me) return
    const nowDone = completed.has(me)
    if (nowDone && !lastDoneRef.current) setBurstKey((k) => k + 1)
    lastDoneRef.current = nowDone
  }, [completed, me])

  if (assignees.length === 0) return null
  const overlap = Math.round(size * 0.35)
  return (
    <div className="flex items-center">
      {assignees.map((u, i) => {
        const done = completed.has(u)
        const isMe = currentUser && u === currentUser.login
        const ring = done ? 'ring-emerald-500' : 'ring-gray-300'
        const canClick = isMe && onToggleMine
        const Wrapper = canClick ? 'button' : 'div'
        const showBurst = isMe && burstKey > 0
        return (
          <Wrapper
            key={u}
            type={canClick ? 'button' : undefined}
            onPointerDown={canClick ? (e) => e.stopPropagation() : undefined}
            onClick={canClick ? (e) => { e.stopPropagation(); onToggleMine() } : undefined}
            title={`${u}${done ? ' ✓ done' : ''}${canClick ? ' — click to toggle' : ''}`}
            className={`relative ${canClick ? 'cursor-pointer hover:scale-110 transition-transform' : ''}`}
            style={{ marginLeft: i === 0 ? 0 : -overlap, zIndex: assignees.length - i }}
          >
            <img
              key={`${u}-${isMe ? burstKey : 0}`}
              src={`https://github.com/${u}.png?size=${size * 2}`}
              alt={u}
              className={`rounded-full ring-2 bg-surface-card ${ring} ${isMe && burstKey > 0 ? 'ph-pop' : ''}`}
              style={{ width: size, height: size }}
            />
            {showBurst && done && (
              <span key={burstKey} className="absolute inset-0 pointer-events-none overflow-visible">
                <span className="ph-sparkle" style={{ '--tx': '-22px', '--ty': '-22px' }} />
                <span className="ph-sparkle" style={{ '--tx': '22px',  '--ty': '-22px', animationDelay: '40ms' }} />
                <span className="ph-sparkle" style={{ '--tx': '-22px', '--ty': '22px',  animationDelay: '80ms' }} />
                <span className="ph-sparkle" style={{ '--tx': '22px',  '--ty': '22px',  animationDelay: '120ms' }} />
                <span className="ph-sparkle" style={{ '--tx': '0px',   '--ty': '-26px', animationDelay: '20ms' }} />
                <span className="ph-sparkle" style={{ '--tx': '0px',   '--ty': '26px',  animationDelay: '100ms' }} />
              </span>
            )}
          </Wrapper>
        )
      })}
    </div>
  )
}

export default function Board() {
  const { owner, repo, currentUser, addPendingWrite, mergePending } = useStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(null)
  const [activeTask, setActiveTask] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [conflict, setConflict] = useState(null)
  const [filterMine, setFilterMine] = useState(false)
  const [selectedTask, setSelectedTask] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [viewFilter, setViewFilter] = useState('active')
  const [filterLabel, setFilterLabel] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)  // { task, refCount }
  const [deleting, setDeleting] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Debounced per-task writes. Optimistic UI updates immediately; the actual
  // GitHub commit fires after PENDING_WRITE_DELAY_MS of inactivity for that
  // task, so rapid toggles (status, assignee ring) coalesce into one commit.
  const PENDING_WRITE_DELAY_MS = 1500
  const tasksRef = useRef(tasks)
  const hasLoadedRef = useRef(false)
  useEffect(() => {
    tasksRef.current = tasks
    // Mirror to the entity cache so other pages (Roadmap, Timeline, Overview,
    // TaskList) see optimistic mutations without re-fetching from GitHub.
    // Skip the mount-time empty array — loadTasks writes the cache itself.
    if (hasLoadedRef.current && owner && repo) {
      useStore.getState().setCached(owner, repo, 'tasks', tasks)
    }
  }, [tasks, owner, repo])
  const pendingWritesRef = useRef(new Map())  // taskId → { timeout, message }

  const loadTasks = useCallback(async () => {
    // Hydrate from cache first so Board doesn't flash empty during refetch.
    const cached = useStore.getState().getCached(owner, repo, 'tasks')
    if (cached) { setTasks(cached); setLoading(false) }
    else setLoading(true)
    try {
      const [files, collabs, tps] = await Promise.all([
        listDirectory(owner, repo, 'tasks'),
        getCollaborators(owner, repo),
        loadTopics(owner, repo).catch(() => []),
      ])
      setMembers(collabs)
      setTopics(tps)
      useStore.getState().setCached(owner, repo, 'topics', tps)
      const jsonFiles = files.filter((f) => f.name.endsWith('.json'))
      const loaded = await Promise.all(
        jsonFiles.map(async (f) => {
          const { content, sha } = await getFileContent(owner, repo, f.path)
          const data = JSON.parse(content)
          return { ...data, _path: f.path, _sha: sha }
        })
      )
      // Preserve locally-pending tasks not yet visible from GitHub.
      const survivors = mergePending('tasks', loaded)
      const next = survivors.length ? [...loaded, ...survivors] : loaded
      setTasks(next)
      useStore.getState().setCached(owner, repo, 'tasks', next)
      hasLoadedRef.current = true
    } catch {
      // Leave existing state alone; the cache (or last known list) keeps the UI populated.
    } finally {
      setLoading(false)
    }
  }, [owner, repo, mergePending])

  useEffect(() => { loadTasks() }, [loadTasks])

  // Auto-open task from ?task= search param
  useEffect(() => {
    const taskName = searchParams.get('task')
    if (!taskName || tasks.length === 0) return
    const match = tasks.find(t => t.title.toLowerCase() === taskName.toLowerCase())
    if (match) {
      setSelectedTask(match.id)
      setSearchParams({}, { replace: true })
    }
  }, [tasks, searchParams, setSearchParams])

  // Stamp/clear `completedAt` so the Recently Completed strip can sort.
  function statusUpdate(task, newStatus) {
    const update = { status: newStatus }
    if (newStatus === 'done' && task.status !== 'done') update.completedAt = new Date().toISOString()
    if (newStatus !== 'done' && task.status === 'done') update.completedAt = null
    return update
  }

  function stripMeta(t) {
    const { _sha, _path, ...rest } = t
    return rest
  }

  function cancelPendingWrite(taskId) {
    const map = pendingWritesRef.current
    const existing = map.get(taskId)
    if (existing) {
      clearTimeout(existing.timeout)
      map.delete(taskId)
    }
  }

  function scheduleTaskCommit(taskId, commitMessage) {
    const map = pendingWritesRef.current
    const existing = map.get(taskId)
    if (existing) clearTimeout(existing.timeout)
    const entry = { message: commitMessage }
    entry.timeout = setTimeout(() => {
      map.delete(taskId)
      flushTaskCommit(taskId, entry.message)
    }, PENDING_WRITE_DELAY_MS)
    map.set(taskId, entry)
    setSyncing(taskId)
  }

  async function flushTaskCommit(taskId, message) {
    const task = tasksRef.current.find((t) => t.id === taskId)
    if (!task || !task._path) { setSyncing(null); return }
    try {
      const { sha: latestSha, content: latestContent } = await getFileContent(owner, repo, task._path)

      // Conflict: someone else modified this task since we loaded it
      if (task._sha && latestSha !== task._sha) {
        setSyncing(null)
        setConflict({
          task,
          localSnapshot: stripMeta(task),
          message,
          remoteSha: latestSha,
          remoteContent: JSON.parse(latestContent),
        })
        return
      }

      // Merge our local fields onto remote so any unknown fields survive.
      const merged = { ...JSON.parse(latestContent), ...stripMeta(task) }
      const result = await updateFile(
        owner, repo, task._path,
        JSON.stringify(merged, null, 2),
        message,
        latestSha,
      )
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, _sha: result.content.sha } : t)),
      )
    } catch (err) {
      loadTasks()  // rollback to remote truth
      alert(`Sync failed: ${err.message}`)
    } finally {
      setSyncing(null)
    }
  }

  // Flush any still-pending writes when the user navigates away.
  useEffect(() => {
    return () => {
      const map = pendingWritesRef.current
      for (const [taskId, entry] of map.entries()) {
        clearTimeout(entry.timeout)
        // Fire & forget — the unmounted component can't update state, but the
        // commit still lands on GitHub so the next mount sees it.
        flushTaskCommit(taskId, entry.message)
      }
      map.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function moveTask(taskId, newStatus) {
    const task = tasksRef.current.find((t) => t.id === taskId)
    if (!task || task.status === newStatus) return
    const update = statusUpdate(task, newStatus)
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, ...update } : t)),
    )
    scheduleTaskCommit(taskId, `[task] Move "${task.title}" → ${newStatus}`)
  }

  // Toggle the current user's personal completion mark. Status is independent —
  // changes only via drag, Mark Complete, or Reopen.
  async function toggleMyCompletion(taskId) {
    const me = currentUser?.login
    if (!me) return
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    const assignees = getAssignees(task)
    if (!assignees.includes(me)) return
    const completed = getCompletedBy(task)
    const isMine = completed.includes(me)
    const newCompleted = isMine
      ? completed.filter((u) => u !== me)
      : Array.from(new Set([...completed, me]))
    await handleSaveTask(taskId, { completedBy: newCompleted })
  }

  // Conflict resolution handlers
  async function handleConflictOverwrite() {
    if (!conflict) return
    const { task, localSnapshot, message } = conflict
    const { sha: remoteSha, content: remoteContent } = await getFileContent(owner, repo, task._path)
    const merged = { ...JSON.parse(remoteContent), ...localSnapshot }
    const result = await updateFile(
      owner, repo, task._path,
      JSON.stringify(merged, null, 2),
      `${message} (force)`,
      remoteSha,
    )
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, _sha: result.content.sha } : t)),
    )
    setConflict(null)
  }

  async function handleConflictRefresh() {
    setConflict(null)
    await loadTasks()
  }

  async function createTask(title, assignees, description, dueDate, linkedFiles, topicId) {
    const id = `task-${Date.now()}`
    const task = {
      id,
      title,
      status: 'todo',
      assignees: assignees || [],
      completedBy: [],
      description: description || '',
      dueDate: dueDate || null,
      linkedFiles: linkedFiles || [],
      topicId: topicId || null,
      createdBy: currentUser?.login || 'unknown',
      createdAt: new Date().toISOString(),
      labels: [],
    }

    try {
      const result = await updateFile(
        owner, repo,
        `tasks/${id}.json`,
        JSON.stringify(task, null, 2),
        `[task] Create "${title}"`,
      )
      const created = { ...task, _path: `tasks/${id}.json`, _sha: result.content.sha }
      addPendingWrite('tasks', created)
      setTasks((prev) => [...prev, created])
      setShowForm(false)
    } catch (err) {
      alert(`Failed to create task: ${err.message}`)
    }
  }

  async function handleDelete(taskId) {
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return

    let refCount = 0
    try {
      const msgs = await loadMessages(owner, repo)
      refCount = msgs.filter((m) =>
        m.taskRefs?.some((r) => r.toLowerCase() === task.title.toLowerCase()) ||
        m.body?.includes(`#${task.title}`)
      ).length
    } catch {}

    setConfirmDelete({ task, refCount })
  }

  async function performDelete() {
    if (!confirmDelete) return
    const { task } = confirmDelete
    setDeleting(true)
    cancelPendingWrite(task.id)
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    useStore.getState().removePendingWrite('tasks', task.id)
    try {
      const { sha } = await getFileContent(owner, repo, task._path)
      await deleteFile(owner, repo, task._path, `[task] Delete "${task.title}"`, sha)
      setConfirmDelete(null)
    } catch (err) {
      setTasks((prev) => [...prev, task])
      alert(`Delete failed: ${err.message}`)
    } finally {
      setDeleting(false)
    }
  }

  function handleDragStart(event) {
    const task = tasks.find((t) => t.id === event.active.id)
    setActiveTask(task)
    setIsDragging(true)
  }

  function handleDragEnd(event) {
    setActiveTask(null)
    setIsDragging(false)
    const { active, over } = event
    if (!over) return

    // over.id could be a column id or a task id
    let targetStatus = over.id
    if (!COLUMNS.find((c) => c.id === targetStatus)) {
      const overTask = tasks.find((t) => t.id === over.id)
      if (overTask) targetStatus = overTask.status
      else return
    }

    moveTask(active.id, targetStatus)
  }

  function handleTaskClick(task) {
    if (!isDragging) {
      setSelectedTask(task.id)
    }
  }

  function handleSaveTask(taskId, updates) {
    const task = tasksRef.current.find((t) => t.id === taskId)
    if (!task) return
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t)))
    scheduleTaskCommit(taskId, `[task] Update "${task.title}"`)
  }

  // Compute unique labels across all tasks
  const allLabels = [...new Set(tasks.flatMap((t) => t.labels || []))].sort()

  // Determine which columns to show based on viewFilter
  const visibleColumns = COLUMNS.filter((col) => {
    if (viewFilter === 'active') return col.id !== 'done'
    if (viewFilter === 'done') return col.id === 'done'
    return true // 'all'
  })

  // Done tasks honoring active filters, sorted newest-first by completion time.
  // Older completions (>RECENT_DONE_LIMIT) get rolled into the Done view link.
  const RECENT_DONE_LIMIT = 5
  const filteredDone = tasks
    .filter((t) => t.status === 'done')
    .filter((t) => !filterMine || getAssignees(t).includes(currentUser?.login))
    .filter((t) => !filterLabel || (t.labels || []).includes(filterLabel))
    .sort((a, b) => {
      const ta = new Date(a.completedAt || a.createdAt || 0).getTime()
      const tb = new Date(b.completedAt || b.createdAt || 0).getTime()
      return tb - ta
    })
  const doneCount = filteredDone.length
  const recentDone = filteredDone.slice(0, RECENT_DONE_LIMIT)
  const olderDoneCount = Math.max(0, doneCount - RECENT_DONE_LIMIT)

  // Footer stats — over the unfiltered task set so numbers don't lie.
  const stats = (() => {
    const total = tasks.length
    const done = tasks.filter((t) => t.status === 'done').length
    const active = total - done
    const overdue = tasks.filter(
      (t) => t.status !== 'done' && t.dueDate && isOverdue(t.dueDate),
    ).length
    const mine = currentUser?.login
      ? tasks.filter((t) => t.status !== 'done' && getAssignees(t).includes(currentUser.login)).length
      : null
    return { total, done, active, overdue, mine }
  })()

  if (loading) {
    return (
      <div className="p-8">
        <div className="grid grid-cols-4 gap-4">
          {COLUMNS.map((col) => (
            <div key={col.id} className="space-y-3">
              <div className="h-6 w-20 bg-surface-low rounded-xl animate-pulse" />
              <div className="h-24 bg-surface-low rounded-xl animate-pulse" />
              <div className="h-24 bg-surface-low rounded-xl animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      {conflict && (
        <ConflictDialog
          remoteMeta={{
            updatedBy: conflict.remoteContent?.lastModifiedBy || 'another collaborator',
            updatedAt: null,
          }}
          onOverwrite={handleConflictOverwrite}
          onRefresh={handleConflictRefresh}
          onCancel={() => { setConflict(null); loadTasks() }}
        />
      )}

      {confirmDelete && (
        <DeleteTaskDialog
          task={confirmDelete.task}
          refCount={confirmDelete.refCount}
          deleting={deleting}
          onConfirm={performDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-display font-semibold text-on-surface">Board</h2>
          <button
            onClick={() => setFilterMine(!filterMine)}
            className={`px-3 py-1.5 text-xs rounded-full cursor-pointer transition-all ${
              filterMine
                ? 'bg-primary text-white shadow-card'
                : 'bg-surface-card text-on-surface-variant hover:shadow-card'
            }`}
          >
            My Tasks {filterMine && `(${tasks.filter(t => getAssignees(t).includes(currentUser?.login) && t.status !== 'done').length})`}
          </button>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 gradient-primary text-white text-sm rounded-full hover:shadow-lifted transition-all cursor-pointer font-medium"
        >
          + New Task
        </button>
      </div>

      {/* View filter + Label filter */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {/* View filter buttons */}
        {[
          { key: 'active', label: 'Active' },
          { key: 'all', label: 'All' },
          { key: 'done', label: 'Done' },
        ].map((vf) => (
          <button
            key={vf.key}
            onClick={() => setViewFilter(vf.key)}
            className={`px-3 py-1.5 text-xs rounded-full cursor-pointer transition-all ${
              viewFilter === vf.key
                ? 'gradient-primary text-white'
                : 'bg-surface-card text-on-surface-variant shadow-card hover:shadow-lifted'
            }`}
          >
            {vf.label}
          </button>
        ))}

        {/* Label filter chips */}
        {allLabels.length > 0 && (
          <>
            <span className="w-px h-5 bg-on-surface-dim/20 mx-1" />
            <button
              onClick={() => setFilterLabel(null)}
              className={`px-2.5 py-1 text-[11px] rounded-full cursor-pointer transition-all ${
                filterLabel === null
                  ? 'bg-primary-surface text-primary'
                  : 'bg-surface-card text-on-surface-dim'
              }`}
            >
              All labels
            </button>
            {allLabels.map((label) => (
              <button
                key={label}
                onClick={() => setFilterLabel(filterLabel === label ? null : label)}
                className={`px-2.5 py-1 text-[11px] rounded-full cursor-pointer transition-all ${
                  filterLabel === label
                    ? 'bg-primary-surface text-primary'
                    : 'bg-surface-card text-on-surface-dim'
                }`}
              >
                {label}
              </button>
            ))}
          </>
        )}
      </div>

      {showForm && <NewTaskForm members={members} topics={topics} onSubmit={createTask} onCancel={() => setShowForm(false)} />}

      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className={`grid gap-4`} style={{ gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(0, 1fr))` }}>
          {visibleColumns.map((col) => (
            <Column
              key={col.id}
              column={col}
              tasks={tasks.filter((t) => {
                if (t.status !== col.id) return false
                if (filterMine && !getAssignees(t).includes(currentUser?.login)) return false
                if (filterLabel && !(t.labels || []).includes(filterLabel)) return false
                return true
              })}
              syncing={syncing}
              topics={topics}
              currentUser={currentUser}
              onDelete={handleDelete}
              onTaskClick={handleTaskClick}
              onComplete={(taskId) => moveTask(taskId, 'done')}
              onReopen={(taskId) => moveTask(taskId, 'todo')}
              onToggleMine={toggleMyCompletion}
            />
          ))}
        </div>

        {/* Recently Completed — shown inline so accidental marks are easy to undo */}
        {viewFilter === 'active' && recentDone.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="font-display font-semibold text-sm text-on-surface">Recently Completed</span>
              <span className="text-xs text-on-surface-dim">{recentDone.length}{olderDoneCount > 0 ? ` of ${doneCount}` : ''}</span>
              {olderDoneCount > 0 && (
                <button
                  onClick={() => setViewFilter('done')}
                  className="ml-auto text-xs text-on-surface-dim hover:text-primary cursor-pointer flex items-center gap-1"
                >
                  View all done ({doneCount})
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
                  </svg>
                </button>
              )}
            </div>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${RECENT_DONE_LIMIT}, minmax(0, 1fr))` }}>
              {recentDone.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  topics={topics}
                  currentUser={currentUser}
                  isSyncing={syncing === task.id}
                  onDelete={handleDelete}
                  onClick={() => handleTaskClick(task)}
                  onComplete={(taskId) => moveTask(taskId, 'done')}
                  onReopen={(taskId) => moveTask(taskId, 'todo')}
                  onToggleMine={toggleMyCompletion}
                />
              ))}
            </div>
          </div>
        )}

        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} isDragging /> : null}
        </DragOverlay>
      </DndContext>

      {/* Stats footer */}
      <div className="mt-10 pt-6 border-t" style={{ borderColor: 'var(--color-surface-low)' }}>
        <div className={`grid gap-3 ${stats.mine !== null ? 'grid-cols-5' : 'grid-cols-4'}`}>
          <StatCard label="Total" value={stats.total} color="var(--color-primary)" />
          <StatCard label="Active" value={stats.active} color="#4456ba" />
          <StatCard label="Done" value={stats.done} color="#10b981" />
          <StatCard label="Overdue" value={stats.overdue} color="#ef4444" />
          {stats.mine !== null && <StatCard label="My Active" value={stats.mine} color="#8b5cf6" />}
        </div>
      </div>

      {selectedTask && tasks.find(t => t.id === selectedTask) && (
        <TaskDetailModal
          task={tasks.find(t => t.id === selectedTask)}
          members={members}
          topics={topics}
          owner={owner}
          repo={repo}
          currentUser={currentUser}
          navigate={navigate}
          onClose={() => setSelectedTask(null)}
          onComplete={(taskId) => { moveTask(taskId, 'done'); setSelectedTask(null) }}
          onReopen={(taskId) => { moveTask(taskId, 'todo'); setSelectedTask(null) }}
          onSave={handleSaveTask}
          onToggleMine={toggleMyCompletion}
        />
      )}
    </div>
  )
}

function Column({ column, tasks, syncing, topics, currentUser, onDelete, onTaskClick, onComplete, onReopen, onToggleMine }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  return (
    <div ref={setNodeRef} className={`min-h-[200px] rounded-xl p-2 -m-2 transition-colors ${isOver ? 'bg-primary-surface/40' : ''}`}>
      <div className="flex items-center gap-2.5 mb-4">
        <span className={`w-2 h-2 rounded-full ${column.dot}`} />
        <span className="font-display font-semibold text-sm text-on-surface">
          {column.label}
        </span>
        <span className="text-xs text-on-surface-dim">{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2.5">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              topics={topics}
              currentUser={currentUser}
              isSyncing={syncing === task.id}
              onDelete={onDelete}
              onClick={() => onTaskClick(task)}
              onComplete={onComplete}
              onReopen={onReopen}
              onToggleMine={onToggleMine}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  )
}

function TaskCard({ task, isDragging, isSyncing, topics, currentUser, onDelete, onClick, onComplete, onReopen, onToggleMine }) {
  const topic = task.topicId ? (topics || []).find((t) => t.id === task.topicId) : null
  const topicCat = topic ? (TOPIC_CATEGORIES[topic.category] || TOPIC_CATEGORIES.research) : null
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: isSortDragging } = useSortable({ id: task.id })
  const pointerStartRef = useRef(null)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortDragging ? 0.5 : 1,
  }

  function handlePointerDown(e) {
    pointerStartRef.current = { x: e.clientX, y: e.clientY }
    // Forward to dnd-kit listener
    listeners?.onPointerDown?.(e)
  }

  function handlePointerUp(e) {
    if (!pointerStartRef.current) return
    const dx = Math.abs(e.clientX - pointerStartRef.current.x)
    const dy = Math.abs(e.clientY - pointerStartRef.current.y)
    if (dx < 5 && dy < 5 && onClick) {
      onClick()
    }
    pointerStartRef.current = null
  }

  const overdue = task.dueDate && task.status !== 'done' && isOverdue(task.dueDate)
  const isDone = task.status === 'done'

  // One-shot pulse when this card transitions into 'done'.
  const [justDone, setJustDone] = useState(false)
  const lastStatusRef = useRef(task.status)
  useEffect(() => {
    if (lastStatusRef.current !== 'done' && task.status === 'done') {
      setJustDone(true)
      const t = setTimeout(() => setJustDone(false), 950)
      return () => clearTimeout(t)
    }
    lastStatusRef.current = task.status
  }, [task.status])

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      className={`group bg-surface-card rounded-xl p-3.5 cursor-grab active:cursor-grabbing ${
        isDragging ? 'shadow-float opacity-90 rotate-2' : 'shadow-card hover:shadow-lifted'
      } ${justDone ? 'ph-done-pulse' : ''} transition-all relative`}
    >
      {/* Delete button -- top right, visible on hover */}
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(task.id) }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-2.5 right-2.5 w-5 h-5 rounded-lg flex items-center justify-center text-on-surface-dim hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          title="Delete task"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      <div className="flex items-start gap-2.5">
        {/* Complete / reopen button */}
        {(onComplete || onReopen) && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              if (isDone && onReopen) onReopen(task.id)
              else if (!isDone && onComplete) onComplete(task.id)
            }}
            className={`shrink-0 w-5 h-5 mt-0.5 rounded-full border-2 flex items-center justify-center transition-colors cursor-pointer ${
              isDone
                ? 'bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-400 hover:border-emerald-400'
                : 'border-gray-300 hover:border-emerald-400 text-transparent hover:text-emerald-400'
            }`}
            title={isDone ? 'Click to reopen' : 'Mark complete'}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </button>
        )}
        <p className={`text-sm font-medium pr-5 ${isDone ? 'text-on-surface-dim line-through' : 'text-on-surface'}`}>{task.title}</p>
      </div>
      {task.description && (
        <p className="text-xs text-on-surface-dim mt-1 line-clamp-2">{task.description}</p>
      )}
      <div className="flex items-center gap-2 mt-2.5">
        {getAssignees(task).length > 0 && (
          <AssigneeStack
            task={task}
            size={20}
            currentUser={currentUser}
            onToggleMine={onToggleMine ? () => onToggleMine(task.id) : undefined}
          />
        )}
        {task.dueDate && (
          <span className={`text-xs ml-auto ${overdue ? 'text-red-500 font-medium' : 'text-on-surface-dim'}`}>
            {formatDate(task.dueDate)}
          </span>
        )}
        {isSyncing && (
          <span className="text-xs text-primary ml-auto animate-pulse">syncing...</span>
        )}
      </div>
      {(task.labels?.length > 0 || topic) && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {topic && (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${topicCat.color}`}
              title={`Topic: ${topic.title}`}
            >
              <span className={`w-1 h-1 rounded-full ${topicCat.dot}`} />
              #!{topic.title}
            </span>
          )}
          {task.labels?.map((l) => (
            <span key={l} className="px-1.5 py-0.5 bg-primary-surface text-primary rounded text-[10px] font-medium">{l}</span>
          ))}
        </div>
      )}
      {task.linkedFiles?.length > 0 && (
        <div className="flex items-center gap-1 mt-2">
          <svg className="w-3 h-3 text-on-surface-dim" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 0 0-5.656 0l-4 4a4 4 0 1 0 5.656 5.656l1.102-1.101" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 0 0 5.656 0l4-4a4 4 0 0 0-5.656-5.656l-1.1 1.1" />
          </svg>
          <span className="text-[10px] text-on-surface-dim">{task.linkedFiles.length} file{task.linkedFiles.length !== 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  )
}

function TaskDetailModal({ task, members = [], topics = [], owner, repo, currentUser, navigate, onClose, onComplete, onReopen, onSave, onToggleMine }) {
  const taskTopic = task.topicId ? topics.find((t) => t.id === task.topicId) : null
  const taskTopicCat = taskTopic ? (TOPIC_CATEGORIES[taskTopic.category] || TOPIC_CATEGORIES.research) : null
  const column = COLUMNS.find((c) => c.id === task.status)
  const overdue = task.dueDate && task.status !== 'done' && isOverdue(task.dueDate)
  const isDone = task.status === 'done'

  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [relatedMsgs, setRelatedMsgs] = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(true)

  // Load messages that reference this task (bidirectional linking)
  useEffect(() => {
    if (!owner || !repo) return
    setLoadingMsgs(true)
    loadMessages(owner, repo).then((msgs) => {
      const titleLower = task.title.toLowerCase()
      const related = msgs.filter((m) => {
        const refs = m.taskRefs || []
        return refs.some((r) => r.toLowerCase() === titleLower) ||
          m.body?.includes(`#${task.title}`)
      })
      setRelatedMsgs(related)
    }).catch(() => {}).finally(() => setLoadingMsgs(false))
  }, [owner, repo, task.title])
  const [editTitle, setEditTitle] = useState(task.title)
  const [editDescription, setEditDescription] = useState(task.description || '')
  const [editAssignees, setEditAssignees] = useState(getAssignees(task))
  const [editDueDate, setEditDueDate] = useState(task.dueDate || '')
  const [editLabels, setEditLabels] = useState(task.labels || [])
  const [editLinkedFiles, setEditLinkedFiles] = useState((task.linkedFiles || []).join(', '))
  const [editStatus, setEditStatus] = useState(task.status)
  const [editTopicId, setEditTopicId] = useState(task.topicId || '')
  const [newLabelInput, setNewLabelInput] = useState('')

  function enterEditMode() {
    setEditTitle(task.title)
    setEditDescription(task.description || '')
    setEditAssignees(getAssignees(task))
    setEditDueDate(task.dueDate || '')
    setEditLabels([...(task.labels || [])])
    setEditLinkedFiles((task.linkedFiles || []).join(', '))
    setEditStatus(task.status)
    setEditTopicId(task.topicId || '')
    setNewLabelInput('')
    setIsEditing(true)
  }

  function cancelEdit() {
    setIsEditing(false)
  }

  async function handleSave() {
    if (!editTitle.trim()) return
    setSaving(true)
    const linkedFiles = editLinkedFiles
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    // Drop completedBy entries for users no longer assigned.
    const prevCompleted = getCompletedBy(task).filter((u) => editAssignees.includes(u))
    const updates = {
      title: editTitle.trim(),
      description: editDescription.trim(),
      assignees: editAssignees,
      assignee: null,                       // clear legacy field
      completedBy: prevCompleted,
      dueDate: editDueDate || null,
      labels: editLabels,
      linkedFiles,
      status: editStatus,
      topicId: editTopicId || null,
    }
    await onSave(task.id, updates)
    setSaving(false)
    setIsEditing(false)
  }

  function addLabel(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const val = newLabelInput.trim()
      if (val && !editLabels.includes(val)) {
        setEditLabels([...editLabels, val])
      }
      setNewLabelInput('')
    }
  }

  function removeLabel(label) {
    setEditLabels(editLabels.filter((l) => l !== label))
  }

  // Close on Escape
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative bg-surface-card rounded-xl shadow-float w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 pb-0">
          <div className="flex items-start justify-between gap-4">
            {isEditing ? (
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="font-display font-semibold text-lg text-on-surface leading-snug w-full bg-surface-low rounded-lg border-0 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                autoFocus
              />
            ) : (
              <h3 className="font-display font-semibold text-lg text-on-surface leading-snug">{task.title}</h3>
            )}
            <div className="flex items-center gap-2 shrink-0">
              {/* Mark Complete / Reopen button */}
              {!isEditing && (
                isDone ? (
                  onReopen && (
                    <button
                      onClick={() => onReopen(task.id)}
                      className="px-3 py-1.5 text-xs rounded-full cursor-pointer transition-all bg-surface-card text-on-surface-variant shadow-card hover:shadow-lifted border border-gray-200"
                    >
                      Reopen
                    </button>
                  )
                ) : (
                  onComplete && (
                    <button
                      onClick={() => onComplete(task.id)}
                      className="px-3 py-1.5 text-xs rounded-full cursor-pointer transition-all gradient-primary text-white hover:shadow-lifted"
                    >
                      Mark Complete
                    </button>
                  )
                )
              )}
              {/* Edit button */}
              {!isEditing && (
                <button
                  onClick={enterEditMode}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-dim hover:text-on-surface hover:bg-surface-low transition-colors cursor-pointer"
                  title="Edit task"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                  </svg>
                </button>
              )}
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-dim hover:text-on-surface hover:bg-surface-low transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Status badge / dropdown */}
          <div className="flex items-center gap-2 mt-3">
            {isEditing ? (
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                className="px-3 py-1.5 bg-surface-low rounded-lg border-0 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              >
                {COLUMNS.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            ) : (
              <>
                <span className={`w-2 h-2 rounded-full ${column?.dot || 'bg-gray-400'}`} />
                <span className="text-sm font-medium text-on-surface-variant capitalize">{column?.label || task.status}</span>
              </>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Assignees + per-user progress */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-xs font-medium text-on-surface-dim uppercase tracking-wider">Assignees</p>
              {!isEditing && getAssignees(task).length > 1 && (
                <p className="text-[11px] text-on-surface-dim">
                  {getCompletedBy(task).filter((u) => getAssignees(task).includes(u)).length} / {getAssignees(task).length} done
                </p>
              )}
            </div>
            {isEditing ? (
              <AssigneePicker members={members} value={editAssignees} onChange={setEditAssignees} />
            ) : getAssignees(task).length > 0 ? (
              <div className="space-y-1.5">
                {getAssignees(task).map((u) => {
                  const done = getCompletedBy(task).includes(u)
                  const isMe = currentUser && u === currentUser.login
                  const ring = done ? 'ring-emerald-500' : 'ring-gray-300'
                  return (
                    <div key={u} className="flex items-center gap-2.5 py-1">
                      <img
                        src={`https://github.com/${u}.png?size=40`}
                        alt={u}
                        className={`w-7 h-7 rounded-full ring-2 ${ring}`}
                      />
                      <span className="text-sm text-on-surface font-medium flex-1">
                        {u}{isMe && <span className="ml-1 text-xs text-on-surface-dim">(you)</span>}
                      </span>
                      {isMe && onToggleMine ? (
                        <button
                          type="button"
                          onClick={() => onToggleMine(task.id)}
                          className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors cursor-pointer ${
                            done
                              ? 'bg-emerald-500 border-emerald-500 text-white'
                              : 'border-gray-300 hover:border-emerald-400 text-transparent hover:text-emerald-400'
                          }`}
                          title={done ? 'Unmark my completion' : 'Mark my part complete'}
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                      ) : (
                        <span className={`text-[11px] ${done ? 'text-emerald-600' : 'text-on-surface-dim'}`}>
                          {done ? 'Done' : 'Pending'}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-on-surface-dim">Unassigned</p>
            )}
          </div>

          {/* Topic */}
          <div>
            <p className="text-xs font-medium text-on-surface-dim uppercase tracking-wider mb-2">Topic</p>
            {isEditing ? (
              <select
                value={editTopicId}
                onChange={(e) => setEditTopicId(e.target.value)}
                className="w-full px-3 py-2 bg-surface-low rounded-lg border-0 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              >
                <option value="">No topic</option>
                {topics.filter((t) => t.status !== 'done' || t.id === task.topicId).map((t) => (
                  <option key={t.id} value={t.id}>
                    #!{t.title}{t.status === 'done' ? ' (archived)' : ''}
                  </option>
                ))}
              </select>
            ) : taskTopic ? (
              <button
                type="button"
                onClick={() => { onClose(); navigate(`/messages?topic=${encodeURIComponent(taskTopic.title)}`) }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer hover:underline ${taskTopicCat.color}`}
                title="Open topic in Messages"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${taskTopicCat.dot}`} />
                #!{taskTopic.title}
              </button>
            ) : (
              <p className="text-sm text-on-surface-dim">No topic</p>
            )}
          </div>

          {/* Description */}
          <div>
            <p className="text-xs font-medium text-on-surface-dim uppercase tracking-wider mb-2">Description</p>
            {isEditing ? (
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={4}
                placeholder="Add a description..."
                className="w-full px-3 py-2 bg-surface-low rounded-lg border-0 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-none placeholder:text-on-surface-dim"
              />
            ) : task.description ? (
              <p className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-wrap">{task.description}</p>
            ) : (
              <p className="text-sm text-on-surface-dim">No description</p>
            )}
          </div>

          {/* Due date */}
          <div>
            <p className="text-xs font-medium text-on-surface-dim uppercase tracking-wider mb-2">Due Date</p>
            {isEditing ? (
              <input
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
                className="w-full px-3 py-2 bg-surface-low rounded-lg border-0 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            ) : task.dueDate ? (
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-on-surface-dim" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" />
                </svg>
                <span className={`text-sm font-medium ${overdue ? 'text-red-500' : 'text-on-surface'}`}>
                  {formatDate(task.dueDate)}
                  {overdue && <span className="ml-2 text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-full">Overdue</span>}
                </span>
              </div>
            ) : (
              <p className="text-sm text-on-surface-dim">No due date</p>
            )}
          </div>

          {/* Linked files */}
          <div>
            <p className="text-xs font-medium text-on-surface-dim uppercase tracking-wider mb-2">Linked Files</p>
            {isEditing ? (
              <input
                value={editLinkedFiles}
                onChange={(e) => setEditLinkedFiles(e.target.value)}
                placeholder="path/a.js, path/b.py"
                className="w-full px-3 py-2 bg-surface-low rounded-lg border-0 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] placeholder:text-on-surface-dim"
              />
            ) : task.linkedFiles?.length > 0 ? (
              <div className="space-y-1.5">
                {task.linkedFiles.map((file, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-on-surface-variant bg-surface-low rounded-lg px-3 py-2">
                    <svg className="w-4 h-4 text-on-surface-dim shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                      <polyline points="14,2 14,8 20,8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="truncate font-mono text-xs">{file}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-on-surface-dim">No linked files</p>
            )}
          </div>

          {/* Labels */}
          <div>
            <p className="text-xs font-medium text-on-surface-dim uppercase tracking-wider mb-2">Labels</p>
            {isEditing ? (
              <div>
                <div className="flex gap-1.5 flex-wrap mb-2">
                  {editLabels.map((l) => (
                    <span key={l} className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary-surface text-primary rounded-lg text-xs font-medium">
                      {l}
                      <button
                        onClick={() => removeLabel(l)}
                        className="w-3.5 h-3.5 rounded-full hover:bg-primary/20 flex items-center justify-center cursor-pointer"
                        type="button"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  value={newLabelInput}
                  onChange={(e) => setNewLabelInput(e.target.value)}
                  onKeyDown={addLabel}
                  placeholder="Type label and press Enter"
                  className="px-3 py-1.5 bg-surface-low rounded-lg border-0 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] placeholder:text-on-surface-dim w-full"
                />
              </div>
            ) : task.labels?.length > 0 ? (
              <div className="flex gap-1.5 flex-wrap">
                {task.labels.map((l) => (
                  <span key={l} className="px-2.5 py-1 bg-primary-surface text-primary rounded-lg text-xs font-medium">{l}</span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-on-surface-dim">No labels</p>
            )}
          </div>

          {/* Save / Cancel buttons when editing */}
          {isEditing && (
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="px-4 py-2 text-on-surface-variant text-sm rounded-full hover:bg-surface-low transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !editTitle.trim()}
                className="px-5 py-2 gradient-primary text-white text-sm rounded-full hover:shadow-lifted disabled:opacity-50 transition-all cursor-pointer font-medium"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}

          {/* Referenced in Messages (bidirectional link) */}
          <div>
            <p className="text-xs font-medium text-on-surface-dim uppercase tracking-wider mb-2">
              Referenced in Messages
              {!loadingMsgs && relatedMsgs.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 gradient-primary text-white rounded-full text-[9px] font-bold">{relatedMsgs.length}</span>
              )}
            </p>
            {loadingMsgs ? (
              <div className="h-8 bg-surface-low rounded-lg animate-pulse" />
            ) : relatedMsgs.length > 0 ? (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {relatedMsgs.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { onClose(); navigate(`/messages?highlight=${m.id}`) }}
                    className="w-full flex items-start gap-2 p-2 bg-surface-low rounded-lg text-left hover:shadow-card transition-all cursor-pointer"
                  >
                    <img src={`https://github.com/${m.author}.png?size=24`} alt="" className="w-5 h-5 rounded-full shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-on-surface truncate">{m.body}</p>
                      <p className="text-[10px] text-on-surface-dim">{m.author} · {new Date(m.createdAt).toLocaleDateString()}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-on-surface-dim">No messages reference this task</p>
            )}
          </div>

          {/* Created info */}
          <div className="pt-3 border-t" style={{ borderColor: 'var(--color-surface-low)' }}>
            <div className="flex items-center gap-2 text-xs text-on-surface-dim">
              {task.createdBy && (
                <div className="flex items-center gap-1.5">
                  <img
                    src={`https://github.com/${task.createdBy}.png?size=24`}
                    alt={task.createdBy}
                    className="w-4 h-4 rounded-full"
                  />
                  <span>Created by <span className="text-on-surface-variant font-medium">{task.createdBy}</span></span>
                </div>
              )}
              {task.createdAt && (
                <span className="ml-auto">
                  {formatDate(task.createdAt)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AssigneePicker({ members, value, onChange }) {
  const remaining = members.filter((m) => !value.includes(m.login))
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {value.length === 0 && <span className="text-sm text-on-surface-dim">Unassigned</span>}
        {value.map((u) => (
          <span key={u} className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 bg-primary-surface text-primary rounded-full text-xs font-medium">
            <img src={`https://github.com/${u}.png?size=24`} alt={u} className="w-5 h-5 rounded-full" />
            {u}
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== u))}
              className="w-3.5 h-3.5 rounded-full hover:bg-primary/20 flex items-center justify-center cursor-pointer"
              title="Remove"
            >
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
      </div>
      {remaining.length > 0 && (
        <select
          value=""
          onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]) }}
          className="px-3 py-1.5 bg-surface-low rounded-lg border-0 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        >
          <option value="">+ Add assignee…</option>
          {remaining.map((m) => (
            <option key={m.login} value={m.login}>{m.login}</option>
          ))}
        </select>
      )}
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-card px-4 py-3 flex items-center gap-3">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <div>
        <p className="text-lg font-display font-bold text-on-surface leading-tight">{value}</p>
        <p className="text-[11px] text-on-surface-dim">{label}</p>
      </div>
    </div>
  )
}

function DeleteTaskDialog({ task, refCount, deleting, onConfirm, onCancel }) {
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape' && !deleting) onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel, deleting])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={() => !deleting && onCancel()}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-surface-card rounded-2xl shadow-float w-full max-w-sm mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--color-error-surface)] flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-[var(--color-error)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.732 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-semibold text-on-surface">Delete task?</h3>
            <p className="text-sm text-on-surface-variant mt-1 break-words">
              "{task.title}" will be removed permanently.
            </p>
            {refCount > 0 && (
              <p className="text-xs text-on-surface-dim mt-2">
                This task is referenced in {refCount} message{refCount === 1 ? '' : 's'}. Those references will render as deleted.
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="px-4 py-2 text-on-surface-variant text-sm rounded-full hover:bg-surface-low transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="px-4 py-2 bg-[var(--color-error)] text-white text-sm rounded-full hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 font-medium"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

function NewTaskForm({ members = [], topics = [], onSubmit, onCancel }) {
  const [title, setTitle] = useState('')
  const [assignees, setAssignees] = useState([])
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [linkedFilesStr, setLinkedFilesStr] = useState('')
  const [topicId, setTopicId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const openTopics = topics.filter((t) => t.status !== 'done')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    const linkedFiles = linkedFilesStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    await onSubmit(title.trim(), assignees, description.trim(), dueDate || null, linkedFiles, topicId || null)
    setSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface-card rounded-xl shadow-card p-5 mb-5 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {/* Title */}
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-on-surface-dim mb-1.5">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
            placeholder="Task title"
            className="w-full px-3 py-2 bg-surface-low rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-blue-500/30 placeholder:text-on-surface-dim"
          />
        </div>

        {/* Assignees */}
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-on-surface-dim mb-1.5">Assign to</label>
          <AssigneePicker members={members} value={assignees} onChange={setAssignees} />
        </div>

        {/* Description */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-on-surface-dim mb-1.5">Description <span className="text-on-surface-dim font-normal">(optional)</span></label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Add a description..."
            className="w-full px-3 py-2 bg-surface-low rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none placeholder:text-on-surface-dim"
          />
        </div>

        {/* Due date */}
        <div>
          <label className="block text-xs font-medium text-on-surface-dim mb-1.5">Due Date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full px-3 py-2 bg-surface-low rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

        {/* Linked files */}
        <div>
          <label className="block text-xs font-medium text-on-surface-dim mb-1.5">Linked Files</label>
          <input
            value={linkedFilesStr}
            onChange={(e) => setLinkedFilesStr(e.target.value)}
            placeholder="path/a.js, path/b.py"
            className="w-full px-3 py-2 bg-surface-low rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-blue-500/30 placeholder:text-on-surface-dim"
          />
        </div>

        {/* Topic */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-on-surface-dim mb-1.5">
            Topic <span className="text-on-surface-dim font-normal">(optional)</span>
          </label>
          <select
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            className="w-full px-3 py-2 bg-surface-low rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            <option value="">No topic</option>
            {openTopics.map((t) => (
              <option key={t.id} value={t.id}>#!{t.title}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-on-surface-variant text-sm rounded-lg hover:bg-surface-low transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-5 py-2 gradient-primary text-white text-sm rounded-full hover:shadow-lifted disabled:opacity-50 transition-all cursor-pointer font-medium"
        >
          {submitting ? 'Creating...' : 'Create Task'}
        </button>
      </div>
    </form>
  )
}
