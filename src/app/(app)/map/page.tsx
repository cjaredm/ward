import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { canSee } from '@/lib/permissions'
import WardMap from '@/components/WardMap'

/**
 * The ward map.
 *
 * `?org=` arrives from the org chart, where every organization block has a link
 * through to here — the chart answers "who serves in this org", the map answers
 * "where do they live", and the link is what makes them one question. A bare org
 * key is accepted as well as a full group key so the chart can link with what it
 * already has.
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>
}) {
  const { org } = await searchParams
  const user = await currentUser()
  if (!user) redirect('/login')
  // Back to the dashboard rather than a 403 page: it lists what this person can
  // open, which is the useful answer to "you cannot open this".
  if (!canSee(user, 'map')) redirect('/dashboard')

  const initialGroupKey = org
    ? org.startsWith('org:') || org.startsWith('unit:')
      ? org
      : `org:${org}`
    : null

  return <WardMap actorName={user.name} initialGroupKey={initialGroupKey} />
}
