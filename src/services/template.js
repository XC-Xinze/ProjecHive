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

export function generateReadme({ name, description, codeRepo, owner }) {
  const repoLine = codeRepo
    ? `| Code Repository | [${codeRepo.replace(/https?:\/\/github\.com\//, '')}](${codeRepo}) |`
    : '| Code Repository | _Not linked yet_ |'
  const ownerLine = owner
    ? `| Created by | [@${owner}](https://github.com/${owner}) |`
    : ''

  return `# ${name}

> Managed with [ProjectHive](https://github.com/XC-Xinze/ProjecHive)

## Overview

${description || 'Write your project introduction here.'}

## Project Info

| | |
|---|---|
${repoLine}
${ownerLine}
| Status | Active |
| Created | ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} |

## Getting Started

1. Use the **Board** tab to create and manage tasks
2. Use **Messages** to discuss with your team
3. Share documents and links in the **Docs** tab

---

<sub>This project is powered by [ProjectHive](https://github.com/XC-Xinze/ProjecHive) — collaborative project management backed by GitHub.</sub>
`
}

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

// Topic category definitions. Topics group ad-hoc discussions and short-lived
// task batches. Categories are fixed (no free-form) so the sidebar stays tidy.
// Note: "discussion" was deliberately excluded — Messages itself is the
// discussion surface; topics need to add structure beyond that.
export const TOPIC_CATEGORIES = {
  research: { label: 'Research', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  admin:    { label: 'Admin',    color: 'bg-gray-100 text-gray-700', dot: 'bg-gray-500' },
  temp:     { label: 'Temp',     color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  planning: { label: 'Planning', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
}

export const TOPIC_CATEGORY_KEYS = Object.keys(TOPIC_CATEGORIES)

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
