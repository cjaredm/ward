import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'

/**
 * The gate every signed-in page sits behind.
 *
 * Middleware only proves the cookie is a valid JWT — it runs on the Edge and
 * never touches the database. The two checks that need a live row happen here,
 * once, for every page in the group: the account still exists and is active,
 * and a temporary password has been replaced.
 *
 * /change-password and /login live outside this group on purpose. Inside it,
 * the redirect below would point at itself.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser()
  if (!user) redirect('/login')
  if (user.must_change_password) redirect('/change-password')
  return <>{children}</>
}
