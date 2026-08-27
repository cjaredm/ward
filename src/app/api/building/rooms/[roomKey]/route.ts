import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { authErrorResponse, requireSection } from '@/lib/auth'
import { area, normalizeRing, type Pt } from '@/lib/floorplan-geom'
import { Point, Ring, RoomName } from '../../schema'

export const runtime = 'nodejs'

const MIN_AREA = 25

const Body = z.object({
  name: RoomName.optional(),
  /** A full replacement ring. See the note on reshaping below. */
  points: Ring.optional(),
  /** A hand-placed label anchor, or null to go back to the computed one. */
  label: Point.nullish(),
  is_assignable: z.boolean().optional(),
  sort: z.number().int().optional(),
})

type Row = {
  key: string
  name: string
  points: Pt[]
  label_x: number | null
  label_y: number | null
  is_assignable: boolean
  sort: number
}

/**
 * Renames a room, moves its label, or replaces its outline.
 *
 * Reshaping is a full replacement of `points` rather than its own endpoint or a
 * vertex diff: the editor already holds the whole ring, a diff protocol is one
 * more thing to get wrong, and a second route would double the audit paths for
 * the same fact. This is the "fix a room" the ward map has never had — a
 * mistraced parcel there can only be deleted and drawn again.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ roomKey: string }> }) {
  let actor: string
  try {
    actor = (await requireSection('building')).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const { roomKey } = await ctx.params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid change', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const body = parsed.data

  const before = (await sql`
    SELECT key, name, points, label_x, label_y, is_assignable, sort
    FROM building_rooms WHERE key = ${roomKey}
  `) as Row[]
  if (before.length === 0) {
    return NextResponse.json({ error: 'No such room' }, { status: 404 })
  }

  let points: Pt[] | null = null
  if (body.points) {
    points = normalizeRing(body.points as Pt[])
    if (points.length < 3 || area(points) < MIN_AREA) {
      return NextResponse.json(
        { error: 'That outline encloses no area. Add more corners and try again.' },
        { status: 400 },
      )
    }
  }

  // `label` is three-valued: absent leaves it alone, null clears it, a pair sets
  // it. `hasLabel` is what separates the first two cases from each other.
  const hasLabel = 'label' in body
  const labelX = body.label ? body.label[0] : null
  const labelY = body.label ? body.label[1] : null

  await sql`
    UPDATE building_rooms SET
      name          = coalesce(${body.name ?? null}, name),
      points        = coalesce(${points ? JSON.stringify(points) : null}::jsonb, points),
      label_x       = CASE WHEN ${hasLabel} THEN ${labelX} ELSE label_x END,
      label_y       = CASE WHEN ${hasLabel} THEN ${labelY} ELSE label_y END,
      is_assignable = coalesce(${body.is_assignable ?? null}, is_assignable),
      sort          = coalesce(${body.sort ?? null}, sort),
      updated_at    = now(),
      updated_by    = ${actor}
    WHERE key = ${roomKey}
  `

  const changed: Record<string, unknown> = {}
  if (body.name !== undefined && body.name !== before[0].name) {
    changed.name = { from: before[0].name, to: body.name }
  }
  if (points) {
    changed.vertices = { from: before[0].points.length, to: points.length }
    // The whole previous ring, so the audit log is the way back from a bad
    // reshape. It is the only copy of it that exists after this statement.
    changed.points_from = before[0].points
  }
  if (hasLabel) changed.label = { from: [before[0].label_x, before[0].label_y], to: body.label ?? null }
  if (body.is_assignable !== undefined && body.is_assignable !== before[0].is_assignable) {
    changed.is_assignable = { from: before[0].is_assignable, to: body.is_assignable }
  }

  if (Object.keys(changed).length > 0) {
    await sql`
      INSERT INTO audit_log (actor, action, entity_id, diff)
      VALUES (${actor}, 'update_room', ${roomKey}, ${JSON.stringify(changed)})
    `
  }

  return NextResponse.json({ ok: true, key: roomKey })
}

/**
 * Deletes a room, refusing while classes are still assigned to it.
 *
 * The same stance /api/parcels/[parcelId] takes about households: the cascade
 * exists so the database stays consistent, not so a stray tap can take a
 * Sunday's schedule with it. Clear the assignments first, deliberately.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ roomKey: string }> }) {
  let actor: string
  try {
    actor = (await requireSection('building')).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const { roomKey } = await ctx.params

  const rows = (await sql`
    SELECT r.key, r.name, r.points,
           (SELECT count(*)::int FROM room_assignments a WHERE a.room_key = r.key) AS assignments
    FROM building_rooms r WHERE r.key = ${roomKey}
  `) as { key: string; name: string; points: Pt[]; assignments: number }[]

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No such room' }, { status: 404 })
  }
  if (rows[0].assignments > 0) {
    return NextResponse.json(
      {
        error: `${rows[0].name} still has ${rows[0].assignments} class${
          rows[0].assignments === 1 ? '' : 'es'
        } assigned. Remove them first.`,
      },
      { status: 409 },
    )
  }

  await sql`DELETE FROM building_rooms WHERE key = ${roomKey}`

  // The outline goes in the diff: this is the only remaining copy of a room that
  // took somebody twenty taps to trace.
  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'delete_room', ${roomKey},
            ${JSON.stringify({ name: rows[0].name, points: rows[0].points })})
  `

  return NextResponse.json({ ok: true })
}
