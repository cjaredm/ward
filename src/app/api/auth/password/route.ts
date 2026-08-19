import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { authErrorResponse, requireUser, signSession, COOKIE_NAME, cookieOptions } from '@/lib/auth'
import { MIN_PASSWORD_LENGTH, setOwnPassword, verifyPasswordFor } from '@/lib/users'

export const runtime = 'nodejs'

const Body = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200),
})

export async function POST(req: NextRequest) {
  let userId: string
  let name: string
  try {
    const user = await requireUser()
    userId = user.id
    name = user.name
  } catch (err) {
    return authErrorResponse(err)
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Choose a new password of at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 },
    )
  }

  if (!(await verifyPasswordFor(userId, parsed.data.currentPassword))) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 })
  }
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return NextResponse.json({ error: 'Choose a password you have not used here.' }, { status: 400 })
  }

  await setOwnPassword(userId, parsed.data.newPassword)

  // Reissue the cookie so the 7-day window restarts from the change rather than
  // from whenever the temporary password was first used.
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_NAME, await signSession({ sub: userId, name }), cookieOptions())
  return res
}
