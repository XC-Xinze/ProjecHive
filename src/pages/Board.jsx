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
import { listDirectory, getFileContent, updateFile, deleteFile, getCollaborators, loadMessages } from '../services/github'
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

export default function Board() {
  const { owner, repo, currentUser } = useStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const [files, collabs] = await Promise.all([
        listDirectory(owner, repo, 'tasks'),
        getCollaborators(owner, repo),
      ])
      setMembers(collabs)
      const jsonFiles = files.filter((f) => f.name.endsWith('.json'))
      const loaded = await Promise.all(
        jsonFiles.map(async (f) => {
          const { content, sha } = await getFileContent(owner, repo, f.path)
          const data = JSON.parse(content)
          return { ...data, _path: f.path, _sha: sha }
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

  async function moveTask(taskId, newStatus) {
    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.status === newStatus) return

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
    )

    setSyncing(taskId)
    try {
      const { sha: latestSha, content: latestContent } = await getFileContent(owner, repo, task._path)

      // Conflict: someone else modified this task since we loaded it
      if (task._sha && latestSha !== task._sha) {
        setSyncing(null)
        setConflict({
          task, newStatus, remoteSha: latestSha,
          remoteContent: JSON.parse(latestContent),
        })
        return
      }

      const latest = JSON.parse(latestContent)
      latest.status = newStatus

      const result = await updateFile(
        owner, repo, task._path,
        JSON.stringify(latest, null, 2),
        `[task] Move "${task.title}" → ${newStatus}`,
        latestSha
      )
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, status: newStatus, _sha: result.content.sha } : t
        )
      )
    } catch (err) {
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: task.status } : t))
      )
      alert(`Sync failed: ${err.message}`)
    } finally {
      setSyncing(null)
    }
  }

  // Conflict resolution handlers
  async function handleConflictOverwrite() {
    if (!conflict) return
    const { task, newStatus, remoteSha } = conflict
    const { content: latestContent } = await getFileContent(owner, repo, task._path)
    const latest = JSON.parse(latestContent)
    latest.status = newStatus
    const result = await updateFile(
      owner, repo, task._path,
      JSON.stringify(latest, null, 2),
      `[task] Move "${task.title}" → ${newStatus} (force)`,
      remoteSha
    )
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id ? { ...t, status: newStatus, _sha: result.content.sha } : t
      )
    )
    setConflict(null)
  }

  async function handleConflictRefresh() {
    setConflict(null)
    await loadTasks()
  }

  async function createTask(title, assignee, description, dueDate, linkedFiles) {
    const id = `task-${Date.now()}`
    const task = {
      id,
      title,
      status: 'todo',
      assignee: assignee || null,
      description: description || '',
      dueDate: dueDate || null,
      linkedFiles: linkedFiles || [],
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
      setTasks((prev) => [...prev, { ...task, _path: `tasks/${id}.json`, _sha: result.content.sha }])
      setShowForm(false)
    } catch (err) {
      alert(`Failed to create task: ${err.message}`)
    }
  }

  async function handleDelete(taskId) {
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return

    // Check if any messages reference this task
    let refWarning = ''
    try {
      const msgs = await loadMessages(owner, repo)
      const refs = msgs.filter((m) =>
        m.taskRefs?.some((r) => r.toLowerCase() === task.title.toLowerCase()) ||
        m.body?.includes(`#${task.title}`)
      )
      if (refs.length > 0) {
        refWarning = `\n\nThis task is referenced in ${refs.length} message(s). References will show as deleted.`
      }
    } catch {}

    if (!confirm(`Delete "${task.title}"?${refWarning}`)) return

    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    try {
      const { sha } = await getFileContent(owner, repo, task._path)
      await deleteFile(owner, repo, task._path, `[task] Delete "${task.title}"`, sha)
    } catch (err) {
      setTasks((prev) => [...prev, task])
      alert(`Delete failed: ${err.message}`)
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

  async function handleSaveTask(taskId, updates) {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t))
    try {
      const { sha, content } = await getFileContent(owner, repo, task._path)
      const latest = JSON.parse(content)
      Object.assign(latest, updates)
      const result = await updateFile(owner, repo, task._path, JSON.stringify(latest, null, 2), `[task] Update "${latest.title}"`, sha)
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates, _sha: result.content.sha } : t))
    } catch (err) {
      loadTasks() // rollback
      alert(`Save failed: ${err.message}`)
    }
  }

  // Compute unique labels across all tasks
  const allLabels = [...new Set(tasks.flatMap((t) => t.labels || []))].sort()

  // Determine which columns to show based on viewFilter
  const visibleColumns = COLUMNS.filter((col) => {
    if (viewFilter === 'active') return col.id !== 'done'
    if (viewFilter === 'done') return col.id === 'done'
    return true // 'all'
  })

  // Count of done tasks (for the collapsed summary)
  const doneCount = tasks.filter((t) => {
    if (t.status !== 'done') return false
    if (filterMine && t.assignee !== currentUser?.login) return false
    if (filterLabel && !(t.labels || []).includes(filterLabel)) return false
    return true
  }).length

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
            My Tasks {filterMine && `(${tasks.filter(t => t.assignee === currentUser?.login && t.status !== 'done').length})`}
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

      {showForm && <NewTaskForm members={members} onSubmit={createTask} onCancel={() => setShowForm(false)} />}

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
                if (filterMine && t.assignee !== currentUser?.login) return false
                if (filterLabel && !(t.labels || []).includes(filterLabel)) return false
                return true
              })}
              syncing={syncing}
              onDelete={handleDelete}
              onTaskClick={handleTaskClick}
              onComplete={(taskId) => moveTask(taskId, 'done')}
            />
          ))}
        </div>

        {/* Collapsed done summary in active view */}
        {viewFilter === 'active' && doneCount > 0 && (
          <button
            onClick={() => setViewFilter('done')}
            className="mt-4 px-4 py-2.5 bg-surface-card rounded-xl shadow-card text-sm text-on-surface-variant hover:shadow-lifted transition-all cursor-pointer flex items-center gap-2"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Done ({doneCount})</span>
            <svg className="w-4 h-4 ml-1 text-on-surface-dim" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
            </svg>
          </button>
        )}

        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} isDragging /> : null}
        </DragOverlay>
      </DndContext>

      {selectedTask && tasks.find(t => t.id === selectedTask) && (
        <TaskDetailModal
          task={tasks.find(t => t.id === selectedTask)}
          members={members}
          owner={owner}
          repo={repo}
          navigate={navigate}
          onClose={() => setSelectedTask(null)}
          onComplete={(taskId) => { moveTask(taskId, 'done'); setSelectedTask(null) }}
          onReopen={(taskId) => { moveTask(taskId, 'todo'); setSelectedTask(null) }}
          onSave={handleSaveTask}
        />
      )}
    </div>
  )
}

function Column({ column, tasks, syncing, onDelete, onTaskClick, onComplete }) {
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
              isSyncing={syncing === task.id}
              onDelete={onDelete}
              onClick={() => onTaskClick(task)}
              onComplete={onComplete}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  )
}

function TaskCard({ task, isDragging, isSyncing, onDelete, onClick, onComplete }) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      className={`group bg-surface-card rounded-xl p-3.5 cursor-grab active:cursor-grabbing ${
        isDragging ? 'shadow-float opacity-90 rotate-2' : 'shadow-card hover:shadow-lifted'
      } transition-all relative`}
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
        {/* Complete button */}
        {onComplete && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); if (!isDone) onComplete(task.id) }}
            className={`shrink-0 w-5 h-5 mt-0.5 rounded-full border-2 flex items-center justify-center transition-colors cursor-pointer ${
              isDone
                ? 'bg-emerald-500 border-emerald-500 text-white'
                : 'border-gray-300 hover:border-emerald-400 text-transparent hover:text-emerald-400'
            }`}
            title={isDone ? 'Completed' : 'Mark complete'}
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
        {task.assignee && (
          <div className="flex items-center gap-1.5">
            <img
              src={`https://github.com/${task.assignee}.png?size=32`}
              alt={task.assignee}
              className="w-5 h-5 rounded-full"
            />
            <span className="text-xs text-on-surface-dim">{task.assignee}</span>
          </div>
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
      {task.labels?.length > 0 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {task.labels.map((l) => (
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

function TaskDetailModal({ task, members = [], owner, repo, navigate, onClose, onComplete, onReopen, onSave }) {
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
  const [editAssignee, setEditAssignee] = useState(task.assignee || '')
  const [editDueDate, setEditDueDate] = useState(task.dueDate || '')
  const [editLabels, setEditLabels] = useState(task.labels || [])
  const [editLinkedFiles, setEditLinkedFiles] = useState((task.linkedFiles || []).join(', '))
  const [editStatus, setEditStatus] = useState(task.status)
  const [newLabelInput, setNewLabelInput] = useState('')

  function enterEditMode() {
    setEditTitle(task.title)
    setEditDescription(task.description || '')
    setEditAssignee(task.assignee || '')
    setEditDueDate(task.dueDate || '')
    setEditLabels([...(task.labels || [])])
    setEditLinkedFiles((task.linkedFiles || []).join(', '))
    setEditStatus(task.status)
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
    const updates = {
      title: editTitle.trim(),
      description: editDescription.trim(),
      assignee: editAssignee || null,
      dueDate: editDueDate || null,
      labels: editLabels,
      linkedFiles,
      status: editStatus,
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
          {/* Assignee */}
          <div>
            <p className="text-xs font-medium text-on-surface-dim uppercase tracking-wider mb-2">Assignee</p>
            {isEditing ? (
              <select
                value={editAssignee}
                onChange={(e) => setEditAssignee(e.target.value)}
                className="w-full px-3 py-2 bg-surface-low rounded-lg border-0 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.login} value={m.login}>{m.login}</option>
                ))}
              </select>
            ) : task.assignee ? (
              <div className="flex items-center gap-2.5">
                <img
                  src={`https://github.com/${task.assignee}.png?size=40`}
                  alt={task.assignee}
                  className="w-7 h-7 rounded-full"
                />
                <span className="text-sm text-on-surface font-medium">{task.assignee}</span>
              </div>
            ) : (
              <p className="text-sm text-on-surface-dim">Unassigned</p>
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

function NewTaskForm({ members = [], onSubmit, onCancel }) {
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [linkedFilesStr, setLinkedFilesStr] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    const linkedFiles = linkedFilesStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    await onSubmit(title.trim(), assignee, description.trim(), dueDate || null, linkedFiles)
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

        {/* Assignee */}
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-on-surface-dim mb-1.5">Assign to</label>
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="w-full px-3 py-2 bg-surface-low rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.login} value={m.login}>{m.login}</option>
            ))}
          </select>
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
