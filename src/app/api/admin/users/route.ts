import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { authErrorResponse, requireAdmin } from '@/lib/auth'
import { SECTION_KEYS } from '@/lib/permissions'
import { createUser, listUsers, MIN_PASSWORD_LENGTH, normalizeEmail } from '@/lib/users'

export const runtime = 'nodejs'

const Body = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(2).max(60),
  // The admin hands this to the person out of band; they are forced to replace
  // it at first sign-in, so it never needs to be memorable.
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  is_admin: z.boolean().default(false),
  permissions: z.array(z.enum(SECTION_KEYS as [string, ...string[]])).default([]),
})

export async function GET() {
  try {
    await requireAdmin()
  } catch (err) {
    return authErrorResponse(err)
  }
  return NextResponse.json({ users: await listUsers() })
}

export async function POST(req: NextRequest) {
  let actor: string
  try {
    actor = (await requireAdmin()).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid user', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const email = normalizeEmail(parsed.data.email)
  const existing = (await sql`SELECT id FROM users WHERE lower(email) = ${email}`) as { id: string }[]
  if (existing.length > 0) {
    return NextResponse.json({ error: 'That email already has an account.' }, { status: 409 })
  }

  const user = await createUser({ ...parsed.data, email }, actor)

  // Audit records who and what — never the password, and never the plaintext of
  // anything the person will keep using.
  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'create_user', ${user.id},
            ${JSON.stringify({
              email: user.email,
              is_admin: user.is_admin,
              permissions: user.permissions,
            })})
  `

  return NextResponse.json({ user }, { status: 201 })
}
