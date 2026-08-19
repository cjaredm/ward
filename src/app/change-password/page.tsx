import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { MIN_PASSWORD_LENGTH } from '@/lib/users'
import ChangePasswordForm from './ChangePasswordForm'

/**
 * Outside the (app) route group: that group redirects here whenever
 * must_change_password is set, so a page inside it would redirect to itself.
 */
export default async function ChangePasswordPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-neutral-900">
          {user.must_change_password ? 'Choose a password' : 'Change password'}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          {user.must_change_password
            ? 'Your account was set up with a temporary password. Pick your own to continue.'
            : `Signed in as ${user.name}.`}
        </p>
        <ChangePasswordForm minLength={MIN_PASSWORD_LENGTH} forced={user.must_change_password} />
      </div>
    </main>
  )
}
