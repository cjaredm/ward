'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * The email-and-password pair, and what happens after it succeeds.
 *
 * Shared by the /login page and the dialog on the public landing page: the two
 * differ only in what surrounds the fields, and the error handling below — a
 * failed sign in, a network drop, a temporary password — is the part worth
 * having exactly one copy of.
 *
 * Ids come from `useId` rather than being hard-coded: the dialog can be mounted
 * on a page that already has a form, and two `id="email"` labels point at
 * whichever input the browser found first.
 */
export default function SignInForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter()
  const id = useId()
  const [email, setEmail] = useState('')
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
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'Sign in failed.')
        return
      }
      const payload = (await res.json().catch(() => null)) as { mustChangePassword?: boolean } | null
      // A temporary password never gets to browse the app; the (app) layout
      // would bounce them here anyway, this just skips the extra hop.
      router.replace(payload?.mustChangePassword ? '/change-password' : '/dashboard')
      router.refresh()
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor={`${id}-email`} className="block text-sm font-medium text-neutral-800">
          Email
        </label>
        <input
          id={`${id}-email`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          autoFocus={autoFocus}
          required
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 outline-none focus:border-neutral-900"
        />
      </div>

      <div>
        <label htmlFor={`${id}-password`} className="block text-sm font-medium text-neutral-800">
          Password
        </label>
        <input
          id={`${id}-password`}
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
  )
}
