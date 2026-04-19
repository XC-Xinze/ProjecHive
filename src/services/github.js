import { Octokit } from '@octokit/rest'
import { TEMPLATE_CONFIG, generateReadme, TEMPLATE_TASK, REPO_PREFIX } from './template'

let octokit = null
let onCommitCallback = null

export function initOctokit(token) {
  octokit = new Octokit({ auth: token })
  return octokit
}

export function getOctokit() {
  if (!octokit) throw new Error('Octokit not initialized')
  return octokit
}

// Register a callback invoked with the new commit SHA after every write.
// Used to mark commits the local app produced so the sync indicator and
// list refreshes can distinguish self-writes from external updates.
export function setOnCommit(cb) {
  onCommitCallback = cb
}

function notifyCommit(data) {
  const sha = data?.commit?.sha
  if (sha && onCommitCallback) {
    try { onCommitCallback(sha) } catch {}
  }
}

// Validate token + repo access
export async function validateConnection(token, owner, repo) {
  const kit = new Octokit({ auth: token })
  const { data } = await kit.repos.get({ owner, repo })
  return data
}

// List only repos whose name starts with REPO_PREFIX ("gitsync-")
// This avoids exposing unrelated private repos.
export async function listGitSyncRepos(token) {
  const kit = new Octokit({ auth: token })
  const repos = []
  let page = 1
  while (true) {
    const { data } = await kit.repos.listForAuthenticatedUser({
      per_page: 100,
      page,
      sort: 'updated',
      direction: 'desc',
    })
    if (data.length === 0) break
    repos.push(...data.filter((r) => r.name.toLowerCase().startsWith(REPO_PREFIX)))
    // Stop early — if we already passed the prefix alphabetically in a full page,
    // there could still be matches on later pages, but 3 pages is a reasonable cap.
    if (page >= 3) break
    page++
  }
  return repos
}

// Create a new gitsync-* repo and initialize it with template
export async function createProject(name, description, codeRepoUrl, isPrivate = true) {
  const repoName = name.startsWith(REPO_PREFIX) ? name : REPO_PREFIX + name
  const { data: repo } = await getOctokit().repos.createForAuthenticatedUser({
    name: repoName,
    description: description || '',
    private: isPrivate,
    auto_init: false,
  })

  const config = {
    ...TEMPLATE_CONFIG,
    name: description || repoName,
    codeRepo: codeRepoUrl || '',
  }

  // Bootstrap template files
  await updateFile(repo.owner.login, repo.name, 'config.json',
    JSON.stringify(config, null, 2), '[doc] Initialize ProjectHive config')
  const sha = await getFileSha(repo.owner.login, repo.name, 'README.md')
  await updateFile(repo.owner.login, repo.name, 'README.md',
    generateReadme({ name: config.name, description: description, codeRepo: codeRepoUrl, owner: repo.owner.login }),
    '[doc] Initialize README', sha)
  await updateFile(repo.owner.login, repo.name, 'tasks/example.json',
    JSON.stringify(TEMPLATE_TASK, null, 2), '[task] Create example task')

  return repo
}

// Permanently delete a repository. Requires the token to have `delete_repo` scope.
// Throws on failure; caller should handle 403 (missing scope) and 404 (gone) distinctly.
export async function deleteRepo(owner, repo) {
  await getOctokit().repos.delete({ owner, repo })
}

// Fetch file content (decoded)
export async function getFileContent(owner, repo, path, ref) {
  const params = { owner, repo, path }
  if (ref) params.ref = ref
  const { data } = await getOctokit().repos.getContent(params)
  if (data.type !== 'file') throw new Error(`${path} is not a file`)
  return {
    content: decodeURIComponent(escape(atob(data.content))),
    sha: data.sha,
  }
}

// List files in a directory
export async function listDirectory(owner, repo, path) {
  try {
    const { data } = await getOctokit().repos.getContent({ owner, repo, path })
    if (!Array.isArray(data)) return []
    return data
  } catch (e) {
    if (e.status === 404) return []
    throw e
  }
}

// Update (or create) a file
export async function updateFile(owner, repo, path, content, message, sha) {
  const params = {
    owner,
    repo,
    path,
    message,
    content: btoa(unescape(encodeURIComponent(content))),
  }
  if (sha) params.sha = sha
  const { data } = await getOctokit().repos.createOrUpdateFileContents(params)
  notifyCommit(data)
  return data
}

// Delete a file
export async function deleteFile(owner, repo, path, message, sha) {
  const { data } = await getOctokit().repos.deleteFile({
    owner,
    repo,
    path,
    message,
    sha,
  })
  notifyCommit(data)
  return data
}

// Get commit history
export async function getCommits(owner, repo, { perPage = 30, page = 1 } = {}) {
  const { data } = await getOctokit().repos.listCommits({
    owner,
    repo,
    per_page: perPage,
    page,
  })
  return data
}

// Get the latest commit SHA on the default branch (lightweight HEAD probe)
export async function getLatestCommitSha(owner, repo) {
  try {
    const { data } = await getOctokit().repos.listCommits({ owner, repo, per_page: 1 })
    return data[0]?.sha || null
  } catch {
    return null
  }
}

// Get single commit detail (files changed)
export async function getCommitDetail(owner, repo, ref) {
  const { data } = await getOctokit().repos.getCommit({ owner, repo, ref })
  return data
}

// Get full file tree (recursive). Returns list of { path, type, sha, size }.
export async function getRepoTree(owner, repo) {
  const kit = getOctokit()
  const { data: repoData } = await kit.repos.get({ owner, repo })
  const { data: refData } = await kit.git.getRef({ owner, repo, ref: `heads/${repoData.default_branch}` })
  const { data } = await kit.git.getTree({
    owner, repo, tree_sha: refData.object.sha, recursive: '1',
  })
  return data.tree.filter((t) => t.type === 'blob')
}

// Get repo collaborators
export async function getCollaborators(owner, repo) {
  try {
    const { data } = await getOctokit().repos.listCollaborators({ owner, repo })
    return data
  } catch {
    return []
  }
}

// Invite a collaborator
export async function inviteCollaborator(owner, repo, username) {
  const { data } = await getOctokit().repos.addCollaborator({
    owner,
    repo,
    username,
    permission: 'push',
  })
  return data
}

// Remove a collaborator
export async function removeCollaborator(owner, repo, username) {
  await getOctokit().repos.removeCollaborator({ owner, repo, username })
}

// Get pending invitations
export async function getPendingInvitations(owner, repo) {
  try {
    const { data } = await getOctokit().repos.listInvitations({ owner, repo })
    return data
  } catch {
    return []
  }
}

// Get current authenticated user
export async function getCurrentUser() {
  const { data } = await getOctokit().users.getAuthenticated()
  return data
}

// Load config.json from management repo
export async function getConfig(owner, repo) {
  try {
    const { content, sha } = await getFileContent(owner, repo, 'config.json')
    return { config: JSON.parse(content), sha }
  } catch (e) {
    if (e.status === 404) return { config: null, sha: null }
    throw e
  }
}

// Check if the repo has been initialized with ProjectHive template
export async function isRepoInitialized(owner, repo) {
  const { config } = await getConfig(owner, repo)
  return config !== null
}

// Get SHA of an existing file, or null if it doesn't exist
async function getFileSha(owner, repo, path) {
  try {
    const { sha } = await getFileContent(owner, repo, path)
    return sha
  } catch {
    return null
  }
}

// Initialize a repo with the ProjectHive template structure
export async function initializeRepo(owner, repo, projectName, codeRepoUrl) {
  const config = {
    ...TEMPLATE_CONFIG,
    name: projectName || TEMPLATE_CONFIG.name,
    codeRepo: codeRepoUrl || '',
  }

  // For each file: check if it already exists (e.g. GitHub auto-created README),
  // get its SHA if so, then create or update.
  const files = [
    { path: 'config.json', content: JSON.stringify(config, null, 2), msg: '[doc] Initialize ProjectHive config' },
    { path: 'README.md', content: generateReadme({ name: config.name, description: config.description, codeRepo: codeRepoUrl, owner }), msg: '[doc] Initialize README' },
    { path: 'tasks/example.json', content: JSON.stringify(TEMPLATE_TASK, null, 2), msg: '[task] Create example task' },
  ]

  for (const f of files) {
    const sha = await getFileSha(owner, repo, f.path)
    await updateFile(owner, repo, f.path, f.content, f.msg, sha)
  }

  return config
}

// ── Docs CRUD (docs/*.json) ──

export async function loadDocs(owner, repo) {
  const files = await listDirectory(owner, repo, 'docs')
  const jsonFiles = files.filter((f) => f.name.endsWith('.json'))
  return Promise.all(jsonFiles.map(async (f) => {
    const { content, sha } = await getFileContent(owner, repo, f.path)
    return { ...JSON.parse(content), _path: f.path, _sha: sha }
  }))
}

export async function createDoc(owner, repo, doc) {
  const id = `doc-${Date.now()}`
  const data = { id, ...doc, createdAt: new Date().toISOString() }
  await updateFile(owner, repo, `docs/${id}.json`,
    JSON.stringify(data, null, 2), `[doc] Share "${doc.title}"`)
  return data
}

// ── Messages CRUD (messages/*.json) ──

export async function loadMessages(owner, repo) {
  const files = await listDirectory(owner, repo, 'messages')
  const jsonFiles = files.filter((f) => f.name.endsWith('.json'))
  const msgs = await Promise.all(jsonFiles.map(async (f) => {
    const { content, sha } = await getFileContent(owner, repo, f.path)
    return { ...JSON.parse(content), _path: f.path, _sha: sha }
  }))
  return msgs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

export async function createMessage(owner, repo, msg) {
  const id = `msg-${Date.now()}`
  const data = { id, ...msg, createdAt: new Date().toISOString() }
  const mentions = (msg.body.match(/@([\w-]+)/g) || []).map((m) => m.slice(1))
  data.mentions = mentions
  const path = `messages/${id}.json`
  const result = await updateFile(owner, repo, path,
    JSON.stringify(data, null, 2), `[discuss] ${msg.body.slice(0, 60)}`)
  return { ...data, _path: path, _sha: result.content.sha }
}

// ── Topics CRUD (topics/*.json) ──

export async function loadTopics(owner, repo) {
  const files = await listDirectory(owner, repo, 'topics')
  const jsonFiles = files.filter((f) => f.name.endsWith('.json'))
  const topics = await Promise.all(jsonFiles.map(async (f) => {
    const { content, sha } = await getFileContent(owner, repo, f.path)
    return { ...JSON.parse(content), _path: f.path, _sha: sha }
  }))
  return topics.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

export async function createTopic(owner, repo, topic) {
  const id = `topic-${Date.now()}`
  const data = {
    id,
    title: topic.title,
    category: topic.category,
    status: 'open',
    createdBy: topic.createdBy || 'unknown',
    createdAt: new Date().toISOString(),
    doneAt: null,
  }
  const path = `topics/${id}.json`
  const result = await updateFile(owner, repo, path,
    JSON.stringify(data, null, 2), `[topic] Open "${topic.title}"`)
  return { ...data, _path: path, _sha: result.content.sha }
}

export async function updateTopic(owner, repo, topic, updates) {
  const { content, sha } = await getFileContent(owner, repo, topic._path)
  const latest = JSON.parse(content)
  Object.assign(latest, updates)
  const result = await updateFile(owner, repo, topic._path,
    JSON.stringify(latest, null, 2),
    updates.status === 'done' ? `[topic] Archive "${latest.title}"` : `[topic] Update "${latest.title}"`,
    sha)
  return { ...latest, _path: topic._path, _sha: result.content.sha }
}

export async function deleteTopic(owner, repo, topic) {
  const { sha } = await getFileContent(owner, repo, topic._path)
  await deleteFile(owner, repo, topic._path, `[topic] Delete "${topic.title}"`, sha)
}

// Upload a binary file (already base64 encoded) to assets/
export async function uploadAsset(owner, repo, fileName, base64Content) {
  const path = `assets/${Date.now()}-${fileName}`
  const { data } = await getOctokit().repos.createOrUpdateFileContents({
    owner, repo, path,
    message: `[attach] Upload ${fileName}`,
    content: base64Content,
  })
  notifyCommit(data)
  return { path, sha: data.content.sha, url: data.content.html_url }
}

// Get raw file content as base64 (for binary downloads)
export async function getRawFileBase64(owner, repo, path) {
  const { data } = await getOctokit().repos.getContent({ owner, repo, path })
  return { content: data.content, name: data.name, size: data.size }
}

// Delete a commit from history by rebasing (force-push)
export async function deleteCommitFromHistory(owner, repo, targetSha) {
  const kit = getOctokit()

  // Get recent commits (newest first)
  const { data: allCommits } = await kit.repos.listCommits({
    owner, repo, per_page: 100,
  })

  const targetIndex = allCommits.findIndex((c) => c.sha === targetSha)
  if (targetIndex === -1) throw new Error('Commit not found')
  if (targetIndex === allCommits.length - 1) throw new Error('Cannot delete the initial commit')

  // Parent of the target = the commit that will replace it in the chain
  const parentSha = allCommits[targetIndex + 1].sha

  // Commits that come AFTER the target (newer), oldest first — need to be replayed
  const commitsToReplay = allCommits.slice(0, targetIndex).reverse()

  let currentParent = parentSha
  for (const commit of commitsToReplay) {
    const { data: full } = await kit.git.getCommit({ owner, repo, commit_sha: commit.sha })
    const { data: newCommit } = await kit.git.createCommit({
      owner, repo,
      message: full.message,
      tree: full.tree.sha,
      parents: [currentParent],
    })
    currentParent = newCommit.sha
  }

  // Force-update the branch ref
  const { data: repoData } = await kit.repos.get({ owner, repo })
  const branch = repoData.default_branch

  await kit.git.updateRef({
    owner, repo,
    ref: `heads/${branch}`,
    sha: currentParent,
    force: true,
  })
  // Treat the rewritten HEAD as a self-produced commit so the sync indicator
  // doesn't flash for our own force-push.
  if (onCommitCallback) {
    try { onCommitCallback(currentParent) } catch {}
  }
}

// Fetch commits from an external repo (code repo) using the same token
// Parse a GitHub repo URL into { owner, repo }, or null if it's not a valid github.com URL.
export function parseRepoUrl(repoUrl) {
  if (!repoUrl) return null
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?$/)
  return match ? { owner: match[1], repo: match[2] } : null
}

export async function getExternalCommits(repoUrl, { perPage = 3 } = {}) {
  const parsed = parseRepoUrl(repoUrl)
  if (!parsed) return []
  try {
    const { data } = await getOctokit().repos.listCommits({
      owner: parsed.owner,
      repo: parsed.repo,
      per_page: perPage,
    })
    return data
  } catch {
    return []
  }
}
