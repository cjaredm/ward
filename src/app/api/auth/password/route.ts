import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { authErrorResponse, requireUser, signSession, COOKIE_NAME, cookieOptions } from '@/lib/auth'
import { passwordProblem, setOwnPassword, verifyPasswordFor } from '@/lib/users'

export const runtime = 'nodejs'

const Body = z.object({
  /**
   * Omitted on a forced first change: the person proved they hold the temporary
   * password by signing in with it moments ago, and the session cookie carries
   * that proof. Still required for a voluntary change, where the session may be
   * days old and the screen possibly unattended.
   */
  currentPassword: z.string().min(1).max(200).optional(),
  newPassword: z.string().min(1).max(200),
})

export async function POST(req: NextRequest) {
  let userId: string
  let name: string
  let forced: boolean
  try {
    const user = await requireUser()
    userId = user.id
    name = user.name
    forced = user.must_change_password
  } catch (err) {
    return authErrorResponse(err)
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a new password.' }, { status: 400 })
  }
  const { currentPassword, newPassword } = parsed.data

  if (!forced) {
    if (!currentPassword) {
      return NextResponse.json({ error: 'Enter your current password.' }, { status: 400 })
    }
    if (!(await verifyPasswordFor(userId, currentPassword))) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 })
    }
  }

  const problem = passwordProblem(newPassword)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  // Compared against the stored hash rather than the submitted current password,
  // so the forced path — which never sends one — still refuses to keep the
  // temporary password the admin handed out.
  if (await verifyPasswordFor(userId, newPassword)) {
    return NextResponse.json({ error: 'Choose a password you have not used here.' }, { status: 400 })
  }

  await setOwnPassword(userId, newPassword)

  // Reissue the cookie so the 7-day window restarts from the change rather than
  // from whenever the temporary password was first used.
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_NAME, await signSession({ sub: userId, name }), cookieOptions())
  return res
}
