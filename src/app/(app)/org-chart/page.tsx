import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { sql } from '@/lib/db'
import { canSee, visibleSections } from '@/lib/permissions'
import type { CallingRecord } from '@/lib/org-tree'
import OrgChartView from '@/components/OrgChartView'
import TopNav from '@/components/TopNav'

export const dynamic = 'force-dynamic'

/**
 * The ward org chart, as a line of authority or as a list.
 *
 * Rows are read in report order, which is what makes a presidency read as a
 * presidency rather than as four people sorted alphabetically. Vacant callings
 * are included, not hidden: the openings are the point of the page.
 *
 * The page is a fixed-height shell rather than a scrolling document: the chart
 * takes every pixel under the header and pans inside itself, and the list gets
 * the scrollbar instead.
 */
export default async function OrgChartPage() {
  const user = await currentUser()
  if (!user) redirect('/login')
  if (!canSee(user, 'org_chart')) redirect('/dashboard')

  const rows = (await sql`
    SELECT c.id, c.org_key, c.name, c.unit, c.is_custom, c.sort, c.printed_name,
           p.full_name, p.photo_url
    FROM callings c
    LEFT JOIN people p ON p.id = c.person_id
    WHERE c.released_at IS NULL
    ORDER BY c.sort, c.name
  `) as CallingRecord[]

  const held = rows.filter((r) => r.full_name || r.printed_name).length
  const unlinked = rows.filter((r) => !r.full_name && r.printed_name).length

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-neutral-50">
      <header className="shrink-0 border-b border-neutral-200 bg-white">
        <div className="flex w-full items-center justify-between gap-3 px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">Org chart</h1>
            <p className="text-sm text-neutral-500">
              {held} calling{held === 1 ? '' : 's'} filled ·{' '}
              <span className="font-medium text-red-600">{rows.length - held} vacant</span>
              {unlinked > 0 && ` · ${unlinked} held by someone not in the ward records yet`}
            </p>
          </div>
          <TopNav
            links={visibleSections(user).map((s) => ({ href: s.href, label: s.label }))}
            isAdmin={user.is_admin}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {rows.length === 0 ? (
          <div className="mx-auto max-w-6xl px-6 py-6">
            <p className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
              No callings recorded yet.{' '}
              {user.is_admin ? (
                <>
                  Upload the LCR callings report on the{' '}
                  <Link href="/admin/import" className="underline underline-offset-2">
                    import page
                  </Link>
                  .
                </>
              ) : (
                'Ask an admin to import the callings report.'
              )}
            </p>
          </div>
        ) : (
          <OrgChartView rows={rows} canSeeMap={canSee(user, 'map')} />
        )}
      </div>
    </main>
  )
}
