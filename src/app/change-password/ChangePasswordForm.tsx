'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const INPUT =
  'mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 outline-none focus:border-neutral-900'

export default function ChangePasswordForm({
  minLength,
  rules,
  forced,
}: {
  minLength: number
  rules: string
  forced: boolean
}) {
  const router = useRouter()
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirm) {
      setError('The two new passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The forced first change omits it entirely — signing in with the
        // temporary password is the proof, so it is not asked for twice.
        body: JSON.stringify(forced ? { newPassword } : { currentPassword, newPassword }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'Could not change the password.')
        return
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
    <form onSubmit={submit} className="mt-6 space-y-4">
      {!forced && (
        <div>
          <label htmlFor="current" className="block text-sm font-medium text-neutral-800">
            Current password
          </label>
          <input
            id="current"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
            className={INPUT}
          />
        </div>
      )}

      <div>
        <label htmlFor="next" className="block text-sm font-medium text-neutral-800">
          New password
        </label>
        <input
          id="next"
          type="password"
          value={newPassword}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          required
          minLength={minLength}
          className={INPUT}
        />
        <p className="mt-1 text-xs text-neutral-500">
          {rules} This is the only thing guarding ward addresses and phone numbers.
        </p>
      </div>

      <div>
        <label htmlFor="confirm" className="block text-sm font-medium text-neutral-800">
          Confirm new password
        </label>
        <input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
          minLength={minLength}
          className={INPUT}
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
        {busy ? 'Saving…' : 'Save password'}
      </button>

      {!forced && (
        <Link href="/" className="block text-center text-sm text-neutral-600 underline underline-offset-2">
          Back to dashboard
        </Link>
      )}
    </form>
  )
}
