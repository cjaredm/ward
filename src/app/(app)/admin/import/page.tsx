import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { visibleSections } from '@/lib/permissions'
import TopNav from '@/components/TopNav'
import CallingsImport from './CallingsImport'
import MembersImport from './MembersImport'
import RostersImport from './RostersImport'

export const dynamic = 'force-dynamic'

/**
 * The import tools. Admin-only: one upload here rewrites callings for the whole
 * ward, and the members tool will do the same for addresses.
 */
export default async function ImportPage() {
  const user = await currentUser()
  if (!user) redirect('/login')
  if (!user.is_admin) redirect('/')

  return (
    <main className="min-h-dvh bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">Import from LCR</h1>
            <p className="text-sm text-neutral-500">
              Upload a report, review what would change, then apply it.
            </p>
          </div>
          <TopNav
            links={visibleSections(user).map((s) => ({ href: s.href, label: s.label }))}
            isAdmin={user.is_admin}
          />
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="text-base font-semibold text-neutral-900">Order matters</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Work down the page. The member list is the only report that adds people; callings and
            rosters can only match names against people already on record, so running either of them
            first fills the review with rows LCR knows about and this ward does not.
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-neutral-600">
            <li>
              <strong>Member list</strong> — who is in the ward, and where they live.
            </li>
            <li>
              <strong>Callings report</strong> — what each of them has been called to.
            </li>
            <li>
              <strong>Organization rosters</strong> — which organization and class each belongs to.
            </li>
          </ol>
          <p className="mt-3 text-sm text-neutral-600">
            Every report is a PDF: preview, then apply. Nothing is written until you apply, and the
            file is never stored.
          </p>
        </section>

        <MembersImport />

        <CallingsImport />

        <RostersImport />
      </div>
    </main>
  )
}
