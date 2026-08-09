'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'Sign in failed.')
        return
      }
      try {
        localStorage.setItem('ward:name', name)
      } catch {
        // private browsing — the JWT already carries the name, this is only a convenience
      }
      router.replace('/')
      router.refresh()
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-neutral-900">Ward Map</h1>
        <p className="mt-1 text-sm text-neutral-600">Sign in to continue.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-neutral-800">
              Your name
            </label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              minLength={2}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 outline-none focus:border-neutral-900"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Recorded with your edits so the ward can see who changed what. It is not a password.
            </p>
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-neutral-800">
              Ward password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 outline-none focus:border-neutral-900"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-neutral-900 px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <section className="mt-8 rounded-md border border-neutral-200 bg-white p-4 text-xs leading-relaxed text-neutral-600">
          <h2 className="text-xs font-semibold text-neutral-900">About your information</h2>
          <p className="mt-2">
            This map stores household names, home addresses, phone numbers and email addresses for
            members of this ward, including minors. Parcel boundaries and street addresses come from
            public Washington County records; everything else is entered by hand by ward leaders.
          </p>
          <p className="mt-2">
            Only people with this password can see it. It is never indexed by search engines, never
            shared publicly, and is not connected to any Church system.
          </p>
          <p className="mt-2">
            To have your household removed, ask any member of the ward council — removal is
            immediate and permanent.
          </p>
        </section>
      </div>
    </main>
  )
}
