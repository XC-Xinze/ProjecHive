import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { listDirectory, getFileContent, getCollaborators } from '../services/github'

const DAY_PX = 6 // pixels per day — compact enough for wide range
const BAR_H = 32
const ROW_GAP = 8
const LABEL_W = 220

const STATUS_COLOR = {
  todo:    { bg: '#9ca3af', light: '#f3f4f6' },
  doing:   { bg: '#4456ba', light: '#eef0ff' },
  done:    { bg: '#10b981', light: '#ecfdf5' },
  blocked: { bg: '#ef4444', light: '#fef2f2' },
}

function getAssignees(task) {
  if (Array.isArray(task.assignees)) return task.assignees
  if (task.assignee) return [task.assignee]
  return []
}
function getCompletedBy(task) {
  return Array.isArray(task.completedBy) ? task.completedBy : []
}

function daysBetween(a, b) { return Math.round((b - a) / 86400000) }
function startOfDay(d) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r }

export default function Roadmap() {
  const { owner, repo } = useStore()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0)
  const [hoveredTask, setHoveredTask] = useState(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const scrollRef = useRef(null)

  const loadData = useCallback(async () => {
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
      setTasks(loaded.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)))
    } catch {
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [owner, repo])

  useEffect(() => { loadData() }, [loadData])

  const today = useMemo(() => startOfDay(new Date()), [])

  // 8 week window
  const { rangeStart, rangeEnd, totalDays } = useMemo(() => {
    const base = addDays(today, weekOffset * 7)
    const start = addDays(base, -21)
    const end = addDays(base, 35)
    return { rangeStart: start, rangeEnd: end, totalDays: daysBetween(start, end) }
  }, [today, weekOffset])

  const chartWidth = totalDays * DAY_PX

  // Week markers for date scale
  const weekMarkers = useMemo(() => {
    const markers = []
    let d = new Date(rangeStart)
    // Align to next Monday
    const dayOfWeek = d.getDay()
    const toMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek
    d = addDays(d, toMonday)
    while (d < rangeEnd) {
      const offset = daysBetween(rangeStart, d)
      markers.push({
        date: new Date(d),
        x: offset * DAY_PX,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      })
      d = addDays(d, 7)
    }
    return markers
  }, [rangeStart, rangeEnd])

  // Month headers
  const monthHeaders = useMemo(() => {
    const months = []
    let current = null
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(rangeStart, i)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      if (!current || current.key !== key) {
        current = {
          key,
          label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
          startX: i * DAY_PX,
        }
        months.push(current)
      }
      current.endX = (i + 1) * DAY_PX
    }
    return months
  }, [rangeStart, totalDays])

  const todayX = useMemo(() => {
    const diff = daysBetween(rangeStart, today)
    if (diff < 0 || diff >= totalDays) return null
    return diff * DAY_PX
  }, [rangeStart, today, totalDays])

  // Scroll to today on mount
  useEffect(() => {
    if (scrollRef.current && todayX !== null) {
      scrollRef.current.scrollLeft = Math.max(0, todayX - 300)
    }
  }, [todayX, loading])

  function getBar(task) {
    const created = startOfDay(new Date(task.createdAt))
    const now = startOfDay(new Date())
    let end
    let ongoing = false
    if (task.dueDate) {
      end = startOfDay(new Date(task.dueDate))
      if (task.status === 'done' && end > now) end = now
    } else {
      end = now
      ongoing = true
    }
    const startOff = daysBetween(rangeStart, created)
    const endOff = daysBetween(rangeStart, end)
    const barStart = Math.max(startOff, 0)
    const barEnd = Math.min(endOff, totalDays)
    if (barEnd <= barStart) return null
    return {
      left: barStart * DAY_PX,
      width: (barEnd - barStart) * DAY_PX,
      ongoing,
      clippedLeft: startOff < 0,
      clippedRight: endOff > totalDays,
    }
  }

  // Stats
  const stats = useMemo(() => {
    const now = new Date()
    const soon = addDays(now, 3)
    let onTrack = 0, atRisk = 0, overdue = 0
    tasks.forEach((t) => {
      if (t.status === 'done' || !t.dueDate) { onTrack++; return }
      const due = new Date(t.dueDate); due.setHours(23, 59, 59, 999)
      if (due < now) overdue++
      else if (due <= soon) atRisk++
      else onTrack++
    })
    return { onTrack, atRisk, overdue }
  }, [tasks])

  if (loading) {
    return (
      <div className="p-10">
        <div className="h-8 w-48 bg-surface-low rounded-xl animate-pulse mb-6" />
        <div className="bg-surface-low rounded-xl animate-pulse h-80" />
      </div>
    )
  }

  return (
    <div className="p-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display font-bold text-xl text-on-surface">Roadmap</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            className="w-8 h-8 bg-surface-card shadow-card rounded-full flex items-center justify-center text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <button
            onClick={() => setWeekOffset(0)}
            className="px-3 py-1.5 text-xs bg-surface-card shadow-card rounded-full text-on-surface-variant hover:text-on-surface cursor-pointer font-medium transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            className="w-8 h-8 bg-surface-card shadow-card rounded-full flex items-center justify-center text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Status legend */}
      <div className="flex items-center gap-4 mb-5">
        {[
          { key: 'todo', label: 'Todo' },
          { key: 'doing', label: 'In Progress' },
          { key: 'done', label: 'Done' },
          { key: 'blocked', label: 'Blocked' },
        ].map(({ key, label }) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: STATUS_COLOR[key].bg }} />
            <span className="text-xs text-on-surface-dim">{label}</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      {tasks.length > 0 ? (
        <div className="bg-surface-card rounded-2xl shadow-card overflow-hidden">
          <div className="flex">
            {/* Left: task labels (sticky) */}
            <div
              className="shrink-0 sticky left-0 z-20 bg-surface-card"
              style={{ width: LABEL_W, boxShadow: '2px 0 8px rgba(0,0,0,0.04)' }}
            >
              {/* Scale header spacer */}
              <div className="h-12" />

              {/* Task rows */}
              <div className="px-4" style={{ paddingTop: ROW_GAP }}>
                {tasks.map((task, i) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2"
                    style={{
                      height: BAR_H,
                      marginBottom: ROW_GAP,
                      opacity: hoveredTask === task.id ? 1 : hoveredTask ? 0.4 : 1,
                      transition: 'opacity 0.2s',
                      overflow: 'hidden',
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: STATUS_COLOR[task.status]?.bg }}
                    />
                    <span className="text-xs text-on-surface font-medium truncate" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                      {task.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: chart area (scrollable) */}
            <div className="flex-1 overflow-x-auto" ref={scrollRef}>
              <div style={{ width: chartWidth, minHeight: 60 }} className="relative">

                {/* Date scale */}
                <div className="h-12 relative" style={{ borderBottom: '1px solid var(--color-surface-low)' }}>
                  {/* Month labels */}
                  {monthHeaders.map((m) => (
                    <div
                      key={m.key}
                      className="absolute top-0 h-5 flex items-center text-[10px] text-on-surface-dim font-medium uppercase tracking-wider"
                      style={{ left: m.startX, width: m.endX - m.startX, paddingLeft: 4, overflow: 'hidden', whiteSpace: 'nowrap' }}
                    >
                      {m.label}
                    </div>
                  ))}
                  {/* Week tick marks + labels */}
                  {weekMarkers.map((w, i) => {
                    const nextX = weekMarkers[i + 1]?.x
                    const availableSpace = nextX != null ? nextX - w.x : Infinity
                    return (
                      <div key={i} className="absolute" style={{ left: w.x, top: 20, bottom: 0 }}>
                        <div className="w-px h-3" style={{ backgroundColor: 'var(--color-surface-highest)' }} />
                        {availableSpace > 40 && (
                          <span className="absolute top-3 left-1 text-[10px] text-on-surface-dim whitespace-nowrap" style={{ overflow: 'hidden' }}>
                            {w.label}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Task bars */}
                <div style={{ paddingTop: ROW_GAP }}>
                  {tasks.map((task) => {
                    const bar = getBar(task)
                    const color = STATUS_COLOR[task.status] || STATUS_COLOR.todo
                    const isHovered = hoveredTask === task.id
                    const displayWidth = bar ? Math.max(bar.width, 6) : 0
                    const showContent = displayWidth >= 30

                    return (
                      <div
                        key={task.id}
                        className="relative"
                        style={{
                          height: BAR_H,
                          marginBottom: ROW_GAP,
                        }}
                      >
                        {/* Light track line */}
                        <div
                          className="absolute top-1/2 -translate-y-1/2 rounded-full"
                          style={{
                            left: 0,
                            right: 0,
                            height: 2,
                            backgroundColor: 'var(--color-surface-low)',
                          }}
                        />

                        {/* Bar */}
                        {bar && (
                          <div
                            className="absolute top-0 flex items-center gap-1.5 cursor-pointer"
                            style={{
                              left: bar.left,
                              width: displayWidth,
                              height: BAR_H,
                              backgroundColor: color.bg,
                              borderRadius: 8,
                              borderTopLeftRadius: bar.clippedLeft ? 0 : 8,
                              borderBottomLeftRadius: bar.clippedLeft ? 0 : 8,
                              borderTopRightRadius: bar.clippedRight || bar.ongoing ? 4 : 8,
                              borderBottomRightRadius: bar.clippedRight || bar.ongoing ? 4 : 8,
                              opacity: task.status === 'done' ? 0.7 : 0.9,
                              transform: isHovered ? 'scaleY(1.1)' : 'scaleY(1)',
                              transition: 'transform 0.2s, box-shadow 0.2s',
                              boxShadow: isHovered ? '0 4px 16px rgba(0,0,0,0.15)' : 'none',
                              paddingLeft: showContent ? 6 : 0,
                              paddingRight: showContent ? 8 : 0,
                              overflow: 'hidden',
                            }}
                            onMouseEnter={() => setHoveredTask(task.id)}
                            onMouseLeave={() => setHoveredTask(null)}
                            onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                          >
                            {/* Ongoing dashed edge */}
                            {bar.ongoing && showContent && (
                              <div
                                className="absolute top-0 right-0 bottom-0 w-3"
                                style={{
                                  background: `repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(255,255,255,0.3) 2px, rgba(255,255,255,0.3) 4px)`,
                                }}
                              />
                            )}

                            {/* Avatars */}
                            {(() => {
                              const assignees = getAssignees(task)
                              if (assignees.length === 0 || displayWidth <= 40) return null
                              const completed = getCompletedBy(task)
                              const visible = assignees.slice(0, 3)
                              return (
                                <div className="flex items-center shrink-0">
                                  {visible.map((u, i) => (
                                    <img
                                      key={u}
                                      src={`https://github.com/${u}.png?size=24`}
                                      alt={u}
                                      title={`${u}${completed.includes(u) ? ' ✓' : ''}`}
                                      className={`w-5 h-5 rounded-full ring-2 ${completed.includes(u) ? 'ring-emerald-300' : 'ring-white/30'}`}
                                      style={{ marginLeft: i === 0 ? 0 : -7, zIndex: visible.length - i }}
                                    />
                                  ))}
                                  {assignees.length > visible.length && (
                                    <span className="text-white/80 text-[10px] ml-1">+{assignees.length - visible.length}</span>
                                  )}
                                </div>
                              )
                            })()}

                            {/* Title inside bar */}
                            {displayWidth > 100 && (
                              <span className="text-white text-[11px] font-medium truncate select-none" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                                {task.title}
                              </span>
                            )}

                            {/* Due date at end */}
                            {displayWidth > 200 && task.dueDate && (
                              <span className="text-white/60 text-[10px] ml-auto shrink-0 select-none" style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>
                                {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Today line */}
                {todayX !== null && (
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none z-30"
                    style={{ left: todayX }}
                  >
                    <div className="w-0.5 h-full" style={{ backgroundColor: 'var(--color-primary)' }} />
                    <div
                      className="absolute -top-0 -translate-x-1/2 px-1.5 py-0.5 rounded-b-md text-[9px] font-bold text-white"
                      style={{ backgroundColor: 'var(--color-primary)', left: 1 }}
                    >
                      TODAY
                    </div>
                  </div>
                )}

                {/* Hover tooltip — rendered via portal with fixed positioning */}
                {hoveredTask && (() => {
                  const task = tasks.find((t) => t.id === hoveredTask)
                  if (!task) return null
                  return createPortal(
                    <div
                      className="fixed z-[9999] px-3 py-2.5 bg-[var(--color-on-surface)] text-white text-xs rounded-xl shadow-float pointer-events-none"
                      style={{
                        left: mousePos.x + 12,
                        top: mousePos.y + 16,
                        maxWidth: 280,
                      }}
                    >
                      <p className="font-medium" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{task.title}</p>
                      <div className="flex items-center gap-2 mt-1 text-white/70" style={{ whiteSpace: 'nowrap' }}>
                        <span className="capitalize">{task.status}</span>
                        {(() => {
                          const a = getAssignees(task)
                          if (a.length === 0) return null
                          const c = getCompletedBy(task)
                          return <span>· {a.length === 1 ? a[0] : `${a.length} people (${c.filter((u) => a.includes(u)).length}/${a.length})`}</span>
                        })()}
                        {task.dueDate && (
                          <span>· Due {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        )}
                      </div>
                    </div>,
                    document.body
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-surface-card rounded-2xl shadow-card p-16 text-center">
          <p className="text-on-surface-dim text-sm">No tasks yet. Create tasks on the Board to see them here.</p>
        </div>
      )}

      {/* Stats */}
      {tasks.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mt-6">
          <StatCard color="#10b981" label="On Track" value={stats.onTrack} />
          <StatCard color="#f59e0b" label="At Risk" value={stats.atRisk} />
          <StatCard color="#ef4444" label="Overdue" value={stats.overdue} />
        </div>
      )}
    </div>
  )
}

function StatCard({ color, label, value }) {
  return (
    <div className="bg-surface-card rounded-xl shadow-card p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs text-on-surface-dim font-medium">{label}</span>
      </div>
      <p className="text-2xl font-display font-bold text-on-surface">{value}</p>
    </div>
  )
}
