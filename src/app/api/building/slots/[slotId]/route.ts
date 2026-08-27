import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { authErrorResponse, requireAdmin } from '@/lib/auth'
import { Clock } from '../../schema'

export const runtime = 'nodejs'

const Body = z.object({
  label: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .transform((v) => (v ? v : null)),
  starts_at: Clock.optional(),
  ends_at: Clock.optional(),
  sort: z.number().int().optional(),
  is_active: z.boolean().optional(),
})

type Row = {
  id: string
  label: string | null
  starts_at: string
  ends_at: string
  sort: number
  is_active: boolean
}

/**
 * Moves or renames a block.
 *
 * This is the operation the whole opaque-id design exists for: the 9:10 block
 * becoming the 9:15 block is one UPDATE here, and every assignment that
 * references it stays exactly where it was.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ slotId: string }> }) {
  let actor: string
  try {
    actor = (await requireAdmin()).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const { slotId } = await ctx.params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid change', issues: parsed.error.issues }, { status: 400 })
  }
  const body = parsed.data

  const before = (await sql`
    SELECT id::text, label, starts_at::text, ends_at::text, sort, is_active
    FROM meeting_slots WHERE id = ${slotId}::uuid
  `) as Row[]
  if (before.length === 0) return NextResponse.json({ error: 'No such hour' }, { status: 404 })

  // Checked here rather than left to the CHECK constraint so a half-edit — a new
  // start time against the stored end time — gets a sentence back.
  const starts = body.starts_at ?? before[0].starts_at.slice(0, 5)
  const ends = body.ends_at ?? before[0].ends_at.slice(0, 5)
  if (ends <= starts) {
    return NextResponse.json({ error: 'The hour has to end after it starts.' }, { status: 400 })
  }

  const hasLabel = 'label' in body

  await sql`
    UPDATE meeting_slots SET
      label     = CASE WHEN ${hasLabel} THEN ${body.label ?? null} ELSE label END,
      starts_at = coalesce(${body.starts_at ?? null}::time, starts_at),
      ends_at   = coalesce(${body.ends_at ?? null}::time, ends_at),
      sort      = coalesce(${body.sort ?? null}, sort),
      is_active = coalesce(${body.is_active ?? null}, is_active)
    WHERE id = ${slotId}::uuid
  `

  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'update_meeting_slot', ${slotId},
            ${JSON.stringify({ from: before[0], to: body })})
  `

  return NextResponse.json({ ok: true })
}

/**
 * Deletes a block, refusing while anything is assigned to it.
 *
 * The foreign key is RESTRICT for the same reason: an hour that is not meeting
 * this year should be switched off, not deleted, so that what met in it is still
 * there when it comes back. The error says so.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ slotId: string }> }) {
  let actor: string
  try {
    actor = (await requireAdmin()).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const { slotId } = await ctx.params

  const rows = (await sql`
    SELECT s.id::text,
           (SELECT count(*)::int FROM room_assignments a WHERE a.slot_id = s.id) AS assignments
    FROM meeting_slots s WHERE s.id = ${slotId}::uuid
  `) as { id: string; assignments: number }[]

  if (rows.length === 0) return NextResponse.json({ error: 'No such hour' }, { status: 404 })
  if (rows[0].assignments > 0) {
    return NextResponse.json(
      {
        error: `${rows[0].assignments} class${
          rows[0].assignments === 1 ? '' : 'es'
        } are assigned to this hour. Turn the hour off instead of deleting it.`,
      },
      { status: 409 },
    )
  }

  await sql`DELETE FROM meeting_slots WHERE id = ${slotId}::uuid`
  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'delete_meeting_slot', ${slotId}, ${JSON.stringify({})})
  `

  return NextResponse.json({ ok: true })
}
