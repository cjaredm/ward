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
        <CallingsImport />

        <RostersImport />

        <MembersImport />
      </div>
    </main>
  )
}
