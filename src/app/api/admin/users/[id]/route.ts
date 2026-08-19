import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { authErrorResponse, requireAdmin } from '@/lib/auth'
import { SECTION_KEYS } from '@/lib/permissions'
import {
  findUserById,
  isLastActiveAdmin,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  resetPassword,
  updateUser,
} from '@/lib/users'

export const runtime = 'nodejs'

const Body = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  email: z.string().trim().email().max(200).optional(),
  is_admin: z.boolean().optional(),
  permissions: z.array(z.enum(SECTION_KEYS as [string, ...string[]])).optional(),
  is_active: z.boolean().optional(),
  /** Present only on an admin-initiated reset; forces a change at next sign-in. */
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200).optional(),
})

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let actor: { id: string; name: string }
  try {
    const admin = await requireAdmin()
    actor = { id: admin.id, name: admin.name }
  } catch (err) {
    return authErrorResponse(err)
  }

  const { id } = await ctx.params
  const target = await findUserById(id)
  if (!target) return NextResponse.json({ error: 'No such user.' }, { status: 404 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid change', issues: parsed.error.issues }, { status: 400 })
  }
  const { password, ...patch } = parsed.data

  // Locking the last way in is unrecoverable without a terminal and the direct
  // database URL, so both routes to it are refused rather than warned about.
  const losesAdmin = patch.is_admin === false || patch.is_active === false
  if (target.is_admin && target.is_active && losesAdmin && (await isLastActiveAdmin(target.id))) {
    return NextResponse.json(
      { error: 'This is the last active admin. Make someone else an admin first.' },
      { status: 409 },
    )
  }

  if (patch.email !== undefined) {
    const email = normalizeEmail(patch.email)
    const clash = (await sql`
      SELECT id FROM users WHERE lower(email) = ${email} AND id <> ${id}
    `) as { id: string }[]
    if (clash.length > 0) {
      return NextResponse.json({ error: 'That email already has an account.' }, { status: 409 })
    }
  }

  if (Object.keys(patch).length > 0) {
    await updateUser(id, patch, actor.name)
    await sql`
      INSERT INTO audit_log (actor, action, entity_id, diff)
      VALUES (${actor.name}, 'update_user', ${id}, ${JSON.stringify(patch)})
    `
  }

  if (password !== undefined) {
    await resetPassword(id, password, actor.name)
    await sql`
      INSERT INTO audit_log (actor, action, entity_id, diff)
      VALUES (${actor.name}, 'reset_password', ${id}, ${JSON.stringify({ reset: true })})
    `
  }

  return NextResponse.json({ user: await findUserById(id) })
}
