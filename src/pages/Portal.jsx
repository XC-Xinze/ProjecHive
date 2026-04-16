import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../store'
import {
  getFileContent,
  getConfig,
  getExternalCommits,
  getCollaborators,
  listDirectory,
} from '../services/github'

export default function Portal() {
  const { owner, repo, currentUser } = useStore()
  const [md, setMd] = useState('')
  const [config, setConfig] = useState(null)
  const [codeCommits, setCodeCommits] = useState([])
  const [taskCount, setTaskCount] = useState(0)
  const [memberCount, setMemberCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [readmeResult, configResult, collaborators, taskFiles] =
          await Promise.all([
            getFileContent(owner, repo, 'README.md').catch(() => null),
            getConfig(owner, repo),
            getCollaborators(owner, repo),
            listDirectory(owner, repo, 'tasks'),
          ])

        if (readmeResult?.content != null) setMd(readmeResult.content)
        setConfig(configResult.config)
        setMemberCount(collaborators.length)
        setTaskCount(
          taskFiles.filter((f) => f.name.endsWith('.json')).length,
        )

        // Collect all linked repo URLs from both codeRepo (string) and codeRepos (array)
        const cfg = configResult.config
        const repoUrls = []
        if (cfg?.codeRepo) repoUrls.push(cfg.codeRepo)
        if (cfg?.codeRepos?.length) {
          cfg.codeRepos.forEach((url) => {
            if (url && !repoUrls.includes(url)) repoUrls.push(url)
          })
        }

        if (repoUrls.length > 0) {
          const allCommitArrays = await Promise.all(
            repoUrls.map((url) =>
              getExternalCommits(url, { perPage: 5 }),
            ),
          )
          const merged = allCommitArrays
            .flat()
            .sort(
              (a, b) =>
                new Date(b.commit.author.date) -
                new Date(a.commit.author.date),
            )
            .slice(0, 5)
          setCodeCommits(merged)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [owner, repo])

  if (loading) {
    return (
      <div className="p-10 space-y-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-5 bg-surface-low rounded-lg animate-pulse"
            style={{ width: `${85 - i * 12}%` }}
          />
        ))}
      </div>
    )
  }

  const greeting = getGreeting()
  const displayName =
    currentUser?.name || currentUser?.login || 'there'

  // Collect all linked repo URLs for the Linked Repos section
  const allRepoUrls = []
  if (config?.codeRepo) allRepoUrls.push(config.codeRepo)
  if (config?.codeRepos?.length) {
    config.codeRepos.forEach((url) => {
      if (url && !allRepoUrls.includes(url)) allRepoUrls.push(url)
    })
  }

  return (
    <div className="p-10 max-w-5xl space-y-8">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-display font-bold text-on-surface">
          {greeting}, {displayName}
        </h1>
        <p className="text-on-surface-variant mt-1">
          You have {taskCount} task{taskCount !== 1 ? 's' : ''} approaching
          deadlines.
        </p>
      </div>

      {/* Project info bar */}
      {config && (
        <div className="bg-surface-card rounded-xl p-5 shadow-card">
          <h2 className="text-lg font-display font-semibold text-on-surface">
            {config.name}
          </h2>
          {config.description && (
            <p className="text-sm text-on-surface-variant mt-1">
              {config.description}
            </p>
          )}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-5">
        <StatCard
          icon={<TaskIcon />}
          iconBg="bg-primary-surface text-primary"
          value={taskCount}
          label="Total Tasks"
        />
        <StatCard
          icon={<MembersIcon />}
          iconBg="bg-emerald-50 text-emerald-600"
          value={memberCount}
          label="Active Members"
        />
        <StatCard
          icon={<CommitIcon />}
          iconBg="bg-amber-50 text-amber-600"
          value={codeCommits.length}
          label="Recent Commits"
        />
      </div>

      {/* Members */}
      {config?.members?.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-xs text-on-surface-dim">Members:</span>
          <div className="flex -space-x-2">
            {config.members.map((m) => (
              <img
                key={m.github}
                src={`https://github.com/${m.github}.png?size=32`}
                alt={m.github}
                title={`${m.github} (${m.role})`}
                className="w-8 h-8 rounded-full ring-2 ring-white"
              />
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {codeCommits.length > 0 && (
        <div className="bg-surface-card rounded-xl p-6 shadow-card">
          <h3 className="text-sm font-display font-semibold text-on-surface mb-4">
            Recent Activity
          </h3>
          <div className="space-y-3">
            {codeCommits.map((c) => {
              const date = new Date(c.commit.author.date)
              const repoName = extractRepoName(c.html_url)
              return (
                <div key={c.sha} className="flex items-center gap-3">
                  {c.author ? (
                    <img
                      src={c.author.avatar_url}
                      alt=""
                      className="w-7 h-7 rounded-full shrink-0"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-surface-low shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-on-surface truncate">
                      {c.commit.message.split('\n')[0]}
                    </p>
                    {repoName && (
                      <span className="text-xs text-on-surface-dim">
                        {repoName}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-on-surface-dim shrink-0 font-mono">
                    {c.sha.slice(0, 7)}
                  </span>
                  <span className="text-xs text-on-surface-dim shrink-0">
                    {formatDate(date)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Linked Repos */}
      {allRepoUrls.length > 0 && (
        <div>
          <h3 className="text-sm font-display font-semibold text-on-surface mb-3">
            Linked Repositories
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {allRepoUrls.map((url) => {
              const name = extractRepoFullName(url)
              return (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-surface-card rounded-xl p-4 shadow-card flex items-center gap-3 hover:shadow-lifted transition-shadow"
                >
                  <div className="w-9 h-9 rounded-lg bg-primary-surface text-primary flex items-center justify-center shrink-0">
                    <CodeIcon />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-on-surface truncate">
                      {name || url}
                    </p>
                    <p className="text-xs text-on-surface-dim truncate">
                      {url}
                    </p>
                  </div>
                </a>
              )
            })}
          </div>
        </div>
      )}

      {/* README */}
      {md ? (
        <article className="bg-surface-card rounded-xl p-6 shadow-card">
          <div className="prose prose-sm prose-gray max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
          </div>
        </article>
      ) : (
        <div className="text-on-surface-dim text-sm">
          No README.md in this repository.
        </div>
      )}
    </div>
  )
}

/* ── Stat Card ── */

function StatCard({ icon, iconBg, value, label }) {
  return (
    <div className="bg-surface-card rounded-xl p-5 shadow-card">
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${iconBg}`}
      >
        {icon}
      </div>
      <p className="text-3xl font-display font-bold text-on-surface">
        {value}
      </p>
      <p className="text-sm text-on-surface-variant mt-0.5">{label}</p>
    </div>
  )
}

/* ── Icons ── */

function CodeIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"
      />
    </svg>
  )
}

function TaskIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z"
      />
    </svg>
  )
}

function MembersIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
      />
    </svg>
  )
}

function CommitIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0v-3m0-12v3m0 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
      />
    </svg>
  )
}

/* ── Helpers ── */

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good Morning'
  if (hour < 17) return 'Good Afternoon'
  return 'Good Evening'
}

function extractRepoName(htmlUrl) {
  if (!htmlUrl) return ''
  const match = htmlUrl.match(/github\.com\/([^/]+\/[^/]+)/)
  return match ? match[1] : ''
}

function extractRepoFullName(repoUrl) {
  if (!repoUrl) return ''
  const match = repoUrl.match(/github\.com\/([^/]+\/[^/\s]+?)(?:\.git)?$/)
  return match ? match[1] : ''
}

function formatDate(date) {
  const now = new Date()
  const diffMs = now - date
  const diffHr = Math.floor(diffMs / 3600000)
  if (diffHr < 1) return 'just now'
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return date.toLocaleDateString()
}
