import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { COOKIE_NAME, verifySession } from '@/lib/auth'
import WardMap from '@/components/WardMap'

export default async function HomePage() {
  const session = await verifySession((await cookies()).get(COOKIE_NAME)?.value)
  if (!session) redirect('/login')

  return <WardMap actorName={session.name} />
}
