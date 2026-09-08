import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { sql } from '@/lib/db'
import { canSee, visibleSections } from '@/lib/permissions'
import MemberList, { type MemberHousehold } from '@/components/MemberList'
import TopNav from '@/components/TopNav'

export const dynamic = 'force-dynamic'

/**
 * Every person in the ward, as a list.
 *
 * The map answers "who lives here"; this page answers "where is this person",
 * which is the question a clerk with a name in hand actually has. Editing is the
 * same form the map panel opens, so a correction made here is a correction made
 * there.
 *
 * Read whole rather than paged: a ward is a few hundred people, and a list you
 * can filter in the browser beats a round trip per keystroke on a phone.
 */
export default async function MembersPage() {
  const user = await currentUser()
  if (!user) redirect('/login')
  if (!canSee(user, 'members')) redirect('/dashboard')

  const rows = (await sql`
    SELECT jsonb_build_object(
      'id', h.id,
      'parcel_id', h.parcel_id,
      'family_name', h.family_name,
      'status', h.status,
      'notes', h.notes,
      'address', h.address,
      -- The county address of the parcel behind this household, if any. A pinned
      -- household has none and carries its own typed address instead.
      'parcel_address', pa.address,
      'updated_at', h.updated_at,
      'updated_by', h.updated_by,
      'people', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', pe.id, 'full_name', pe.full_name, 'photo_url', pe.photo_url,
            'callings', coalesce((
              SELECT jsonb_agg(jsonb_build_object(
                       'id', c.id, 'org_key', c.org_key, 'name', c.name,
                       'unit', c.unit, 'is_custom', c.is_custom
                     ) ORDER BY c.sort)
              FROM callings c WHERE c.person_id = pe.id AND c.released_at IS NULL
            ), '[]'::jsonb),
            'orgs', coalesce((
              SELECT jsonb_agg(DISTINCT po.org_key ORDER BY po.org_key)
              FROM person_orgs po WHERE po.person_id = pe.id
            ), '[]'::jsonb),
            'sort_order', pe.sort_order
          ) ORDER BY pe.sort_order, pe.full_name
        ) FROM people pe WHERE pe.household_id = h.id
      ), '[]'::jsonb)
    ) AS household
    FROM households h
    LEFT JOIN parcels pa ON pa.parcel_id = h.parcel_id
    WHERE h.deleted_at IS NULL
    ORDER BY h.family_name, h.created_at
  `) as { household: MemberHousehold }[]

  const households = rows.map((r) => r.household)
  const people = households.reduce((sum, h) => sum + h.people.length, 0)

  return (
    <main className="min-h-dvh bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-6 py-4">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-neutral-900">Members</h1>
            <p className="truncate text-sm text-neutral-500">
              {people} {people === 1 ? 'person' : 'people'} in {households.length}{' '}
              {households.length === 1 ? 'household' : 'households'}
            </p>
          </div>
          <TopNav
            links={visibleSections(user).map((s) => ({ href: s.href, label: s.label }))}
            isAdmin={user.is_admin}
          />
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        {households.length === 0 ? (
          <p className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
            No households recorded yet.{' '}
            {user.is_admin ? (
              <>
                Upload the LCR member list on the{' '}
                <Link href="/admin/import" className="underline underline-offset-2">
                  import page
                </Link>
                , or add a household from the map.
              </>
            ) : (
              'Ask an admin to import the member list.'
            )}
          </p>
        ) : (
          <MemberList households={households} actorName={user.name} />
        )}
      </div>
    </main>
  )
}
