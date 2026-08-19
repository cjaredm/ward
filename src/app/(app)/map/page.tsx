import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { canSee } from '@/lib/permissions'
import WardMap from '@/components/WardMap'

export default async function MapPage() {
  const user = await currentUser()
  if (!user) redirect('/login')
  // Back to the dashboard rather than a 403 page: it lists what this person can
  // open, which is the useful answer to "you cannot open this".
  if (!canSee(user, 'map')) redirect('/')

  return <WardMap actorName={user.name} />
}
