'use client'

import { useState } from 'react'
import { generateTempPassword } from '@/lib/temp-password'

type User = {
  id: string
  email: string
  name: string
  is_admin: boolean
  permissions: string[]
  must_change_password: boolean
  is_active: boolean
  last_login_at: string | null
  created_at: string
}

type Section = { key: string; label: string }

const INPUT =
  'w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900'

/**
 * A temporary password the admin reads out or pastes into a message, never one
 * anybody has to keep. Generated in the browser so it is shown exactly once and
 * only the bcrypt hash of it ever reaches the server.
 *
 * Rejection sampling rather than `% bound`: the top of the 32-bit range does not
 * divide evenly by 256 or 100, and modulo alone would quietly weight the low
 * words and low digits.
 */
function randomInt(bound: number): number {
  const limit = Math.floor(0x1_0000_0000 / bound) * bound
  const buf = new Uint32Array(1)
  let n: number
  do {
    crypto.getRandomValues(buf)
    n = buf[0]
  } while (n >= limit)
  return n % bound
}

function relative(iso: string | null): string {
  if (!iso) return 'never'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(iso).toLocaleDateString()
}

export default function UsersAdmin({
  initialUsers,
  sections,
  currentUserId,
}: {
  initialUsers: User[]
  sections: Section[]
  currentUserId: string
}) {
  const [users, setUsers] = useState(initialUsers)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  /** Temporary passwords to show once, keyed by user id. Never re-fetchable. */
  const [reveal, setReveal] = useState<Record<string, string>>({})

  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', email: '', is_admin: false, permissions: [] as string[] })

  async function send(url: string, body: unknown): Promise<User | null> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method: url.endsWith('/users') ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = (await res.json().catch(() => null)) as
        | { user?: User; error?: string }
        | null
      if (!res.ok) {
        setError(payload?.error ?? 'That did not save.')
        return null
      }
      return payload?.user ?? null
    } catch {
      setError('Network error. Check your connection and try again.')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault()
    const password = generateTempPassword(randomInt)
    const user = await send('/api/admin/users', { ...draft, password })
    if (!user) return
    setUsers((prev) => [...prev, user])
    setReveal((prev) => ({ ...prev, [user.id]: password }))
    setDraft({ name: '', email: '', is_admin: false, permissions: [] })
    setAdding(false)
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const user = await send(`/api/admin/users/${id}`, body)
    if (!user) return
    setUsers((prev) => prev.map((u) => (u.id === id ? user : u)))
  }

  async function resetPassword(id: string) {
    const password = generateTempPassword(randomInt)
    const user = await send(`/api/admin/users/${id}`, { password })
    if (!user) return
    setUsers((prev) => prev.map((u) => (u.id === id ? user : u)))
    setReveal((prev) => ({ ...prev, [id]: password }))
  }

  function togglePermission(list: string[], key: string): string[] {
    return list.includes(key) ? list.filter((k) => k !== key) : [...list, key]
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {adding ? (
        <form onSubmit={addUser} className="rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-neutral-900">New account</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-neutral-800">Name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
                minLength={2}
                className={`mt-1 ${INPUT}`}
              />
              <span className="mt-1 block text-xs text-neutral-500">
                Recorded on this person&apos;s edits so the ward can see who changed what.
              </span>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-neutral-800">Email</span>
              <input
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                required
                className={`mt-1 ${INPUT}`}
              />
              <span className="mt-1 block text-xs text-neutral-500">Their sign-in.</span>
            </label>
          </div>

          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-neutral-800">Can open</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {sections.map((s) => (
                <label key={s.key} className="flex items-center gap-2 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={draft.is_admin || draft.permissions.includes(s.key)}
                    disabled={draft.is_admin}
                    onChange={() =>
                      setDraft({ ...draft, permissions: togglePermission(draft.permissions, s.key) })
                    }
                  />
                  {s.label}
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={draft.is_admin}
                  onChange={(e) => setDraft({ ...draft, is_admin: e.target.checked })}
                />
                Admin (everything, including this page)
              </label>
            </div>
          </fieldset>

          <p className="mt-4 text-xs text-neutral-500">
            A temporary password is generated and shown once after you save. Send it to them; they
            are forced to replace it the first time they sign in.
          </p>

          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create account'}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-md px-3 py-2 text-sm text-neutral-600"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true)
            setError(null)
          }}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white"
        >
          Add person
        </button>
      )}

      <ul className="space-y-3">
        {users.map((user) => {
          const isSelf = user.id === currentUserId
          return (
            <li
              key={user.id}
              className={`rounded-lg border bg-white p-5 ${user.is_active ? 'border-neutral-200' : 'border-neutral-200 opacity-60'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-neutral-900">
                    {user.name}
                    {isSelf && <span className="ml-2 text-xs text-neutral-500">(you)</span>}
                  </p>
                  <p className="truncate text-sm text-neutral-600">{user.email}</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    Last signed in {relative(user.last_login_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {user.is_admin && (
                    <span className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-white">
                      Admin
                    </span>
                  )}
                  {!user.is_active && (
                    <span className="rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-700">
                      Deactivated
                    </span>
                  )}
                  {user.must_change_password && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      Temporary password
                    </span>
                  )}
                </div>
              </div>

              {reveal[user.id] && (
                <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p className="font-medium">Temporary password — shown once</p>
                  <code className="mt-1 block font-mono text-base break-words">
                    {reveal[user.id]}
                  </code>
                  <button
                    type="button"
                    onClick={() =>
                      setReveal((prev) =>
                        Object.fromEntries(Object.entries(prev).filter(([id]) => id !== user.id)),
                      )
                    }
                    className="mt-2 text-xs underline underline-offset-2"
                  >
                    I have sent it — hide
                  </button>
                </div>
              )}

              {editing === user.id ? (
                <div className="mt-4 space-y-4 border-t border-neutral-200 pt-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="font-medium text-neutral-800">Name</span>
                      <input
                        defaultValue={user.name}
                        onBlur={(e) =>
                          e.target.value.trim() !== user.name &&
                          patch(user.id, { name: e.target.value })
                        }
                        className={`mt-1 ${INPUT}`}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="font-medium text-neutral-800">Email</span>
                      <input
                        type="email"
                        defaultValue={user.email}
                        onBlur={(e) =>
                          e.target.value.trim().toLowerCase() !== user.email &&
                          patch(user.id, { email: e.target.value })
                        }
                        className={`mt-1 ${INPUT}`}
                      />
                    </label>
                  </div>

                  <fieldset>
                    <legend className="text-sm font-medium text-neutral-800">Can open</legend>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {sections.map((s) => (
                        <label
                          key={s.key}
                          className="flex items-center gap-2 text-sm text-neutral-700"
                        >
                          <input
                            type="checkbox"
                            checked={user.is_admin || user.permissions.includes(s.key)}
                            disabled={user.is_admin || busy}
                            onChange={() =>
                              patch(user.id, {
                                permissions: togglePermission(user.permissions, s.key),
                              })
                            }
                          />
                          {s.label}
                        </label>
                      ))}
                      <label className="flex items-center gap-2 text-sm text-neutral-700">
                        <input
                          type="checkbox"
                          checked={user.is_admin}
                          disabled={busy}
                          onChange={(e) => patch(user.id, { is_admin: e.target.checked })}
                        />
                        Admin
                      </label>
                    </div>
                    {user.is_admin && (
                      <p className="mt-2 text-xs text-neutral-500">
                        Admins can open every section, including ones added later.
                      </p>
                    )}
                  </fieldset>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => resetPassword(user.id)}
                      disabled={busy}
                      className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-800 disabled:opacity-50"
                    >
                      Reset password
                    </button>
                    {!isSelf && (
                      <button
                        type="button"
                        onClick={() => patch(user.id, { is_active: !user.is_active })}
                        disabled={busy}
                        className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-800 disabled:opacity-50"
                      >
                        {user.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="rounded-md px-3 py-2 text-sm text-neutral-600"
                    >
                      Done
                    </button>
                  </div>
                  <p className="text-xs text-neutral-500">
                    Changes save as you make them. Accounts are deactivated rather than deleted, so
                    the edits they signed stay attributed.
                  </p>
                </div>
              ) : (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-neutral-600">
                    {user.is_admin
                      ? 'Every section'
                      : user.permissions.length === 0
                        ? 'No sections yet'
                        : sections
                            .filter((s) => user.permissions.includes(s.key))
                            .map((s) => s.label)
                            .join(', ')}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(user.id)
                      setError(null)
                    }}
                    className="shrink-0 text-sm text-neutral-600 underline underline-offset-2"
                  >
                    Manage
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
