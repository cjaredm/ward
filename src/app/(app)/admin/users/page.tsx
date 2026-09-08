import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { SECTIONS, visibleSections } from '@/lib/permissions'
import { listUsers } from '@/lib/users'
import TopNav from '@/components/TopNav'
import UsersAdmin from './UsersAdmin'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const user = await currentUser()
  if (!user) redirect('/login')
  if (!user.is_admin) redirect('/dashboard')

  return (
    <main className="min-h-dvh bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">People &amp; access</h1>
            <p className="text-sm text-neutral-500">
              Accounts that can sign in, and what each one can open.
            </p>
          </div>
          <TopNav
            links={visibleSections(user).map((s) => ({ href: s.href, label: s.label }))}
            isAdmin={user.is_admin}
          />
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-8">
        <UsersAdmin
          initialUsers={await listUsers()}
          sections={SECTIONS.map((s) => ({
            key: s.key,
            label: s.label,
            // Only the building map has one so far; the form renders whatever
            // SECTIONS declares, so a second one needs no change here.
            editKey: 'editKey' in s ? s.editKey : undefined,
          }))}
          currentUserId={user.id}
        />
      </div>
    </main>
  )
}
