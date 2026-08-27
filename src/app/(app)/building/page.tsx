import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { readBuilding } from '@/lib/building-query'
import { canSee, visibleSections } from '@/lib/permissions'
import BuildingMap from '@/components/BuildingMap'
import TopNav from '@/components/TopNav'

export const dynamic = 'force-dynamic'

/**
 * The building map: which class is in which room, hour by hour.
 *
 * Read on the server so the first paint already has the rooms in it — the
 * drawing is the page, and a spinner where the building should be is worse than
 * a moment's wait. The client re-reads /api/building after every edit.
 *
 * `?room=` and `?slot=` are accepted so a link can open a particular room in a
 * particular hour, the way /map?org= already works from the org chart.
 *
 * A fixed-height shell, like the org chart: the drawing takes every pixel under
 * the header and pans inside itself rather than the page scrolling.
 */
export default async function BuildingPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string; slot?: string }>
}) {
  const { room, slot } = await searchParams
  const user = await currentUser()
  if (!user) redirect('/login')
  // Back to the dashboard rather than a 403 page: it lists what this person can
  // open, which is the useful answer to "you cannot open this".
  if (!canSee(user, 'building')) redirect('/')

  const data = await readBuilding()
  const assignable = data.rooms.filter((r) => r.is_assignable).length

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-neutral-50">
      <header className="shrink-0 border-b border-neutral-200 bg-white">
        <div className="flex w-full items-center justify-between gap-3 px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">Building map</h1>
            <p className="text-sm text-neutral-500">
              {data.rooms.length} room{data.rooms.length === 1 ? '' : 's'} · {assignable} hold
              classes · {data.slots.filter((s) => s.is_active).length} hour
              {data.slots.filter((s) => s.is_active).length === 1 ? '' : 's'} on the schedule
            </p>
          </div>
          <TopNav
            links={visibleSections(user).map((s) => ({ href: s.href, label: s.label }))}
            isAdmin={user.is_admin}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {data.rooms.length === 0 ? (
          <div className="mx-auto max-w-3xl px-6 py-6">
            <p className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
              No rooms yet. Save the stake centre floorplan to{' '}
              <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px]">
                data/floorplan-viewer.html
              </code>{' '}
              and run{' '}
              <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px]">
                npm run seed:building
              </code>
              , or trace the rooms by hand once the drawing is in place.
              {user.is_admin && (
                <>
                  {' '}
                  <Link href="/admin/users" className="underline underline-offset-2">
                    Who can see this page
                  </Link>{' '}
                  is set per account.
                </>
              )}
            </p>
          </div>
        ) : (
          <BuildingMap
            initial={data}
            actorName={user.name}
            isAdmin={user.is_admin}
            initialRoomKey={room ?? null}
            initialSlotId={slot ?? null}
          />
        )}
      </div>
    </main>
  )
}
