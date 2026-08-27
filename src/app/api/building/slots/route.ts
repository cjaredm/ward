import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { authErrorResponse, requireAdmin } from '@/lib/auth'
import { Clock } from '../schema'

export const runtime = 'nodejs'

const Body = z
  .object({
    /** Null or blank means "read as the times", which is the normal case. */
    label: z
      .string()
      .trim()
      .max(60)
      .nullish()
      .transform((v) => (v ? v : null)),
    starts_at: Clock,
    ends_at: Clock,
    sort: z.number().int().optional(),
  })
  .refine((b) => b.ends_at > b.starts_at, {
    message: 'The hour has to end after it starts',
    path: ['ends_at'],
  })

/**
 * Adds a block to the Sunday schedule. Admin only.
 *
 * Editing the hours changes them for the whole ward at once, which is a
 * different thing from assigning a class to a room — so these four handlers
 * require an admin while everything else on the building map only requires the
 * section.
 */
export async function POST(req: NextRequest) {
  let actor: string
  try {
    actor = (await requireAdmin()).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid hour', issues: parsed.error.issues }, { status: 400 })
  }
  const { label, starts_at, ends_at, sort } = parsed.data

  const rows = (await sql`
    INSERT INTO meeting_slots (label, starts_at, ends_at, sort)
    VALUES (
      ${label}, ${starts_at}::time, ${ends_at}::time,
      coalesce(${sort ?? null}, (SELECT coalesce(max(sort), 0) + 10 FROM meeting_slots))
    )
    RETURNING id::text
  `) as { id: string }[]

  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'create_meeting_slot', ${rows[0].id},
            ${JSON.stringify({ label, starts_at, ends_at })})
  `

  return NextResponse.json({ id: rows[0].id }, { status: 201 })
}
