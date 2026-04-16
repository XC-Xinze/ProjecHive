import { useEffect, useState } from 'react'
import { useStore } from '../store'
import {
  getCollaborators,
  inviteCollaborator,
  removeCollaborator,
  getPendingInvitations,
  getCurrentUser,
} from '../services/github'

export default function Members() {
  const { owner, repo } = useStore()
  const [members, setMembers] = useState([])
  const [pending, setPending] = useState([])
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Invite form
  const [username, setUsername] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState('')

  useEffect(() => { loadAll() }, [owner, repo])

  async function loadAll() {
    setLoading(true)
    try {
      const [collabs, invites, me] = await Promise.all([
        getCollaborators(owner, repo),
        getPendingInvitations(owner, repo),
        getCurrentUser(),
      ])
      setMembers(collabs)
      setPending(invites)
      setCurrentUser(me)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleInvite(e) {
    e.preventDefault()
    if (!username.trim()) return
    setInviting(true)
    setError('')
    setInviteMsg('')
    try {
      await inviteCollaborator(owner, repo, username.trim())
      setInviteMsg(`Invitation sent to ${username.trim()}`)
      setUsername('')
      loadAll()
    } catch (err) {
      if (err.status === 404) setError(`User "${username.trim()}" not found on GitHub.`)
      else if (err.status === 422) setInviteMsg(`${username.trim()} is already a collaborator.`)
      else setError(err.message)
    } finally {
      setInviting(false)
    }
  }

  async function handleRemove(login) {
    if (login === currentUser?.login) return
    setError('')
    try {
      await removeCollaborator(owner, repo, login)
      setMembers((prev) => prev.filter((m) => m.login !== login))
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-2xl">
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 bg-surface-low rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-2xl">
      <h2 className="font-display font-bold text-xl text-on-surface mb-4">Members</h2>

      {/* Invite form */}
      <form onSubmit={handleInvite} className="bg-surface-card rounded-xl shadow-card p-5 mb-6">
        <div className="flex gap-2">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="GitHub username to invite"
            required
            className="flex-1 px-3 py-2 bg-surface-low border-0 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
          <button
            type="submit"
            disabled={inviting}
            className="px-4 py-2 gradient-primary text-white text-sm rounded-full hover:opacity-90 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
          >
            {inviting ? 'Inviting...' : 'Invite'}
          </button>
        </div>
      </form>

      {error && (
        <div className="bg-red-50 text-red-600 text-sm p-3 rounded-xl mb-4">{error}</div>
      )}
      {inviteMsg && (
        <div className="bg-green-50 text-green-700 text-sm p-3 rounded-xl mb-4">{inviteMsg}</div>
      )}

      {/* Pending invitations */}
      {pending.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-medium text-on-surface-dim uppercase tracking-wide mb-2">Pending Invitations</h3>
          <div className="space-y-2">
            {pending.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 bg-primary-surface rounded-xl p-3">
                <img
                  src={inv.invitee?.avatar_url || ''}
                  alt=""
                  className="w-8 h-8 rounded-full shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-on-surface">{inv.invitee?.login}</p>
                  <p className="text-xs text-primary">Pending acceptance</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current members */}
      <h3 className="text-xs font-medium text-on-surface-dim uppercase tracking-wide mb-2">
        Collaborators ({members.length})
      </h3>
      <div className="space-y-2">
        {members.map((m) => {
          const isOwner = m.permissions?.admin
          const isMe = m.login === currentUser?.login
          return (
            <div
              key={m.login}
              className="flex items-center gap-3 bg-surface-card rounded-xl shadow-card p-4 hover:shadow-lifted transition-all"
            >
              <img src={m.avatar_url} alt="" className="w-8 h-8 rounded-full shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-on-surface">{m.login}</p>
                  {isOwner && (
                    <span className="px-1.5 py-0.5 bg-surface-low text-on-surface-variant text-[10px] rounded-lg font-medium">Owner</span>
                  )}
                  {isMe && (
                    <span className="px-1.5 py-0.5 bg-primary-surface text-primary text-[10px] rounded-lg font-medium">You</span>
                  )}
                </div>
              </div>
              {!isOwner && !isMe && (
                <button
                  onClick={() => handleRemove(m.login)}
                  className="text-xs text-on-surface-dim hover:text-red-500 cursor-pointer px-2 py-1 rounded-lg hover:bg-surface-low transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
