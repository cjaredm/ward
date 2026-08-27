import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { authErrorResponse, requireSection } from '@/lib/auth'
import { roomAvailableAt, warningsFor } from '@/lib/building-query'
import { AssignmentTitle, Notes, OrgKey, Unit } from '../schema'

export const runtime = 'nodejs'

const Body = z.object({
  room_key: z.string().trim().min(1).max(60),
  slot_id: z.string().uuid(),
  title: AssignmentTitle,
  org_key: OrgKey,
  unit: Unit,
  notes: Notes,
})

/**
 * Puts a class in a room for one block.
 *
 * Two classes in the same room in the same block are allowed on purpose — see
 * decision 4 in migration 0014. What comes back instead is `warnings`: the same
 * class in two rooms at once, which is almost always an assignment somebody
 * moved by adding rather than editing. Never blocking, because a combined class
 * genuinely splits across two rooms some weeks.
 */
export async function POST(req: NextRequest) {
  let actor: string
  try {
    actor = (await requireSection('building')).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid assignment', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { room_key, slot_id, title, org_key, unit, notes } = parsed.data

  // A unit names a class inside an organization, so it cannot stand alone. The
  // database enforces this too; caught here to give a sentence rather than a
  // constraint violation.
  if (unit && !org_key) {
    return NextResponse.json(
      { error: 'Pick the organization this class belongs to, or clear the class link.' },
      { status: 400 },
    )
  }

  const slot = (await sql`SELECT id FROM meeting_slots WHERE id = ${slot_id}`) as { id: string }[]
  if (slot.length === 0) return NextResponse.json({ error: 'No such hour' }, { status: 404 })

  // Availability is per hour, not per room: the chapel holds classes and is still
  // not free during sacrament meeting. The hour is checked first because this
  // answer depends on it.
  const room = await roomAvailableAt(room_key, slot_id)
  if (!room.exists) return NextResponse.json({ error: 'No such room' }, { status: 404 })
  if (!room.available) {
    return NextResponse.json(
      { error: `${room.name} is marked as not available this hour. Open it up first.` },
      { status: 409 },
    )
  }

  if (org_key) {
    const org = (await sql`SELECT key FROM orgs WHERE key = ${org_key}`) as { key: string }[]
    if (org.length === 0) {
      return NextResponse.json({ error: `Unknown organization '${org_key}'` }, { status: 400 })
    }
  }

  const rows = (await sql`
    INSERT INTO room_assignments (room_key, slot_id, title, org_key, unit, notes, sort, updated_by)
    VALUES (
      ${room_key}, ${slot_id}::uuid, ${title}, ${org_key}, ${unit}, ${notes},
      coalesce((SELECT max(sort) + 1 FROM room_assignments
                WHERE room_key = ${room_key} AND slot_id = ${slot_id}::uuid), 0),
      ${actor}
    )
    ON CONFLICT (room_key, slot_id, title) DO NOTHING
    RETURNING id::text
  `) as { id: string }[]

  if (rows.length === 0) {
    // The unique index caught a repeat, which in practice is a double tap.
    return NextResponse.json(
      { error: `${title} is already in that room this hour.` },
      { status: 409 },
    )
  }

  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'create_room_assignment', ${rows[0].id},
            ${JSON.stringify({ room_key, slot_id, title, org_key, unit })})
  `

  return NextResponse.json({ id: rows[0].id, warnings: await warningsFor(slot_id) }, { status: 201 })
}
