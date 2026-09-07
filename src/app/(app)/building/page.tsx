import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { readBuilding } from '@/lib/building-query'
import { canEdit, canSee, visibleSections } from '@/lib/permissions'
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
 * A fixed-height shell with no header of its own: the drawing takes every pixel
 * of the viewport and pans inside itself rather than the page scrolling. The nav
 * and the map's own controls float over the plan.
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
  const nav = (
    <TopNav
      links={visibleSections(user).map((s) => ({ href: s.href, label: s.label }))}
      isAdmin={user.is_admin}
    />
  )

  return (
    <main className="building-print-shell relative h-dvh overflow-hidden bg-white">
      {/*
        No header band. Every other page has one; here it was a strip of white
        across the top of a drawing that wants the whole screen, holding a title
        nobody needs twice and three counts that are now behind the About button
        on the map. The nav floats over the plan instead — the top corners of a
        floorplan are empty paper.

        The heading still exists for a screen reader and for the document
        outline; it is only the pixels that are gone.
      */}
      <h1 className="sr-only">Building map</h1>

      {data.rooms.length === 0 ? (
        <>
          <div className="absolute top-3 right-3 z-20">{nav}</div>
          <div className="mx-auto max-w-3xl px-6 py-16">
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
        </>
      ) : (
        <BuildingMap
          initial={data}
          actorName={user.name}
          isAdmin={user.is_admin}
          // Read-only unless this account has the building map's edit
          // permission. The write routes check the same thing themselves — this
          // only decides which controls are worth showing.
          canEdit={canEdit(user, 'building')}
          initialRoomKey={room ?? null}
          initialSlotId={slot ?? null}
          nav={nav}
        />
      )}
    </main>
  )
}
