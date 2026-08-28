import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { visibleSections } from '@/lib/permissions'
import { listQuickLinks, listShareCandidates } from '@/lib/quick-links-query'
import QuickLinks from '@/components/QuickLinks'
import TopNav from '@/components/TopNav'

/**
 * The dashboard. Signing in lands here, not on the map — the map is one section
 * of the app among several still to come, and which of them a person sees is
 * their own permission list.
 */
export default async function DashboardPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  const sections = visibleSections(user)
  // Only an admin can change who a link is for, so only an admin is sent the
  // list of accounts to choose from.
  const [quickLinks, shareCandidates] = await Promise.all([
    listQuickLinks(user),
    user.is_admin ? listShareCandidates() : Promise.resolve([]),
  ])

  return (
    <main className="min-h-dvh bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-6 py-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-neutral-900">Ward</h1>
            <p className="truncate text-sm text-neutral-500">Signed in as {user.name}</p>
          </div>
          <TopNav
            links={sections.map((s) => ({ href: s.href, label: s.label }))}
            isAdmin={user.is_admin}
          />
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-8">
        {sections.length === 0 ? (
          <p className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
            Your account does not have access to any sections yet. Ask an admin to grant you one.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {sections.map((section) => (
              <Link
                key={section.key}
                href={section.href}
                className="group rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-neutral-900"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  aria-hidden
                  className="h-6 w-6 text-neutral-500 group-hover:text-neutral-900"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d={section.icon} />
                </svg>
                <h2 className="mt-3 text-base font-semibold text-neutral-900">{section.label}</h2>
                <p className="mt-1 text-sm text-neutral-600">{section.description}</p>
              </Link>
            ))}
          </div>
        )}

        <QuickLinks
          initial={quickLinks}
          canManage={user.is_admin}
          people={shareCandidates}
        />

        {user.is_admin && (
          <section className="mt-8">
            <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              Admin
            </h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Link
                href="/admin/users"
                className="block rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-neutral-900"
              >
                <h3 className="text-base font-semibold text-neutral-900">People &amp; access</h3>
                <p className="mt-1 text-sm text-neutral-600">
                  Add accounts, set which sections each person can open, reset passwords.
                </p>
              </Link>
              <Link
                href="/admin/import"
                className="block rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-neutral-900"
              >
                <h3 className="text-base font-semibold text-neutral-900">Import from LCR</h3>
                <p className="mt-1 text-sm text-neutral-600">
                  Upload the callings report, review every change, then apply it.
                </p>
              </Link>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
