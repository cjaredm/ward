import Link from 'next/link'
import SignInForm from '@/components/SignInForm'
import { WARD } from '@/lib/ward'

/**
 * Sign in on a page of its own.
 *
 * The landing page's dialog is the front door most people use; this is where
 * middleware sends a request with no session or an expired one, and where an
 * old bookmark lands. Both render the same form.
 */
export const metadata = { title: `Sign in — ${WARD.name}` }

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-neutral-900">Sign in to continue.</h1>
        <p className="mt-1 text-sm text-neutral-600">{WARD.name} ward tools.</p>

        <div className="mt-6">
          <SignInForm />
        </div>

        <Link
          href="/"
          className="mt-6 block text-center text-sm text-neutral-600 underline underline-offset-2"
        >
          Back to the {WARD.name} page
        </Link>
      </div>
    </main>
  )
}
