import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { authErrorResponse, requireSection } from '@/lib/auth'
import { AssignmentTitle, Notes, OrgKey, Unit } from '../../schema'
import { roomAvailableAt, warningsFor } from '@/lib/building-query'

export const runtime = 'nodejs'

const Body = z.object({
  /** Moving a class to another room or hour, rather than retyping it there. */
  room_key: z.string().trim().min(1).max(60).optional(),
  slot_id: z.string().uuid().optional(),
  title: AssignmentTitle.optional(),
  org_key: OrgKey,
  unit: Unit.optional(),
  notes: Notes,
  sort: z.number().int().optional(),
})

type Row = {
  id: string
  room_key: string
  slot_id: string
  title: string
  org_key: string | null
  unit: string
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ assignmentId: string }> },
) {
  let actor: string
  try {
    actor = (await requireSection('building')).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const { assignmentId } = await ctx.params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid change', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const body = parsed.data

  const before = (await sql`
    SELECT id::text, room_key, slot_id::text, title, org_key, unit
    FROM room_assignments WHERE id = ${assignmentId}::uuid
  `) as Row[]
  if (before.length === 0) {
    return NextResponse.json({ error: 'No such assignment' }, { status: 404 })
  }

  // The org link is three-valued the same way the room's label anchor is: absent
  // leaves it, null clears it. Clearing the org has to clear the unit with it,
  // because a unit with no organization resolves to nothing.
  const hasOrg = 'org_key' in body
  const clearing = hasOrg && body.org_key === null
  const unit = clearing ? '' : body.unit
  if (unit && !(body.org_key ?? (hasOrg ? null : before[0].org_key))) {
    return NextResponse.json(
      { error: 'Pick the organization this class belongs to, or clear the class link.' },
      { status: 400 },
    )
  }

  if (body.org_key) {
    const org = (await sql`SELECT key FROM orgs WHERE key = ${body.org_key}`) as { key: string }[]
    if (org.length === 0) {
      return NextResponse.json({ error: `Unknown organization '${body.org_key}'` }, { status: 400 })
    }
  }
  if (body.slot_id) {
    const slot = (await sql`
      SELECT id FROM meeting_slots WHERE id = ${body.slot_id}::uuid
    `) as { id: string }[]
    if (slot.length === 0) return NextResponse.json({ error: 'No such hour' }, { status: 404 })
  }

  // A move is checked against where it is going, in the hour it is going to —
  // which may be the one it is already in. Moving into an hour the destination
  // room is closed for is the case a room-only check would miss.
  if (body.room_key || body.slot_id) {
    const room = await roomAvailableAt(
      body.room_key ?? before[0].room_key,
      body.slot_id ?? before[0].slot_id,
    )
    if (!room.exists) return NextResponse.json({ error: 'No such room' }, { status: 404 })
    if (!room.available) {
      return NextResponse.json(
        { error: `${room.name} is marked as not available that hour.` },
        { status: 409 },
      )
    }
  }

  try {
    await sql`
      UPDATE room_assignments SET
        room_key   = coalesce(${body.room_key ?? null}, room_key),
        slot_id    = coalesce(${body.slot_id ?? null}::uuid, slot_id),
        title      = coalesce(${body.title ?? null}, title),
        org_key    = CASE WHEN ${hasOrg} THEN ${body.org_key ?? null} ELSE org_key END,
        unit       = CASE WHEN ${clearing} THEN '' ELSE coalesce(${unit ?? null}, unit) END,
        notes      = CASE WHEN ${'notes' in body} THEN ${body.notes ?? null} ELSE notes END,
        sort       = coalesce(${body.sort ?? null}, sort),
        updated_at = now(),
        updated_by = ${actor}
      WHERE id = ${assignmentId}::uuid
    `
  } catch (err) {
    // The unique index on (room_key, slot_id, title) — moving this class onto one
    // that is already there.
    if (err instanceof Error && /room_assignments_unique_idx/.test(err.message)) {
      return NextResponse.json(
        { error: 'That room already has a class by that name this hour.' },
        { status: 409 },
      )
    }
    throw err
  }

  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'update_room_assignment', ${assignmentId},
            ${JSON.stringify({ from: before[0], to: body })})
  `

  return NextResponse.json({
    ok: true,
    warnings: await warningsFor(body.slot_id ?? before[0].slot_id),
  })
}

/**
 * Removes a class from a room. A hard delete, unlike a released calling.
 *
 * `callings.released_at` exists because who held a calling is history worth
 * keeping. Which room a class met in last year is not, and soft-deleting these
 * would put a `deleted_at IS NULL` on every read of the map for nothing.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ assignmentId: string }> },
) {
  let actor: string
  try {
    actor = (await requireSection('building')).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const { assignmentId } = await ctx.params
  const rows = (await sql`
    DELETE FROM room_assignments WHERE id = ${assignmentId}::uuid
    RETURNING id::text, room_key, slot_id::text, title, org_key, unit
  `) as Row[]

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No such assignment' }, { status: 404 })
  }

  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'delete_room_assignment', ${assignmentId}, ${JSON.stringify(rows[0])})
  `

  return NextResponse.json({ ok: true })
}
