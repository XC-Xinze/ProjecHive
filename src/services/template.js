// Repo naming convention — only repos whose name starts with this prefix
// will be listed in the repo picker, keeping personal repos private.
// e.g. "gitsync-my-project", "gitsync-nlp-team"
export const REPO_PREFIX = 'gitsync-'

// Default repo template files — created when initializing a new management repo

export const TEMPLATE_CONFIG = {
  name: 'My Project',
  description: 'Project description here.',
  codeRepo: '',
  codeRepos: [],
  members: [],
}

export const TEMPLATE_README = `# My Project

> Managed by [ProjectHive](https://github.com)

## About

Write your project introduction here.

## Code Repository

_(Set in config.json)_

## Members

_(Managed via ProjectHive)_
`

export const TEMPLATE_TASK = {
  id: 'task-example',
  title: 'Example task — delete me',
  status: 'todo',
  assignee: null,
  description: '',
  dueDate: null,
  linkedFiles: [],
  labels: ['example'],
  createdBy: null,
  createdAt: new Date().toISOString(),
}

// Commit message keyword definitions
// Usage: prefix commit messages with [keyword]
// e.g. "[update] Finished experiment A" or "[issue] Data pipeline broken"
export const COMMIT_KEYWORDS = {
  update:  { label: 'Update',   color: 'bg-blue-100 text-blue-700',   icon: '↑' },
  issue:   { label: 'Issue',    color: 'bg-red-100 text-red-700',     icon: '!' },
  hold:    { label: 'Hold',     color: 'bg-yellow-100 text-yellow-700', icon: '⏸' },
  done:    { label: 'Done',     color: 'bg-green-100 text-green-700', icon: '✓' },
  task:    { label: 'Task',     color: 'bg-purple-100 text-purple-700', icon: '▪' },
  discuss: { label: 'Discuss',  color: 'bg-orange-100 text-orange-700', icon: '💬' },
  doc:     { label: 'Doc',      color: 'bg-teal-100 text-teal-700',   icon: '📄' },
}

// Parse "[keyword]" prefix from a commit message
// Returns { keyword, config, message } or { keyword: null, config: null, message }
export function parseCommitMessage(raw) {
  const match = raw.match(/^\[(\w+)\]\s*(.*)/)
  if (match) {
    const key = match[1].toLowerCase()
    const cfg = COMMIT_KEYWORDS[key]
    return { keyword: key, config: cfg || null, message: match[2] }
  }
  return { keyword: null, config: null, message: raw }
}
