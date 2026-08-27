import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { authErrorResponse, requireSectionEdit } from '@/lib/auth'
import { slugifyRoomKey } from '@/lib/building'
import { area, normalizeRing, type Pt } from '@/lib/floorplan-geom'
import { Ring, RoomName } from '../schema'

export const runtime = 'nodejs'

/** Smaller than this in floorplan units is a mistrace, not a cupboard. */
const MIN_AREA = 25

const Body = z.object({
  name: RoomName,
  points: Ring,
  is_assignable: z.boolean().default(true),
})

/**
 * Creates a room from an outline traced on the map.
 *
 * The ring is normalized server-side — deduplicated, unclosed, wound
 * consistently — so geometry in the database has one shape regardless of which
 * direction somebody happened to trace in.
 */
export async function POST(req: NextRequest) {
  let actor: string
  try {
    actor = (await requireSectionEdit('building')).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid room', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { name, is_assignable } = parsed.data
  const points = normalizeRing(parsed.data.points as Pt[])

  if (points.length < 3 || area(points) < MIN_AREA) {
    return NextResponse.json(
      { error: 'That outline encloses no area. Add more corners and try again.' },
      { status: 400 },
    )
  }

  // Keys are slugs, and three rooms in this building really are called
  // "Bishop's Office", so the suffix is picked against what is already stored.
  const existing = (await sql`SELECT key FROM building_rooms`) as { key: string }[]
  const key = slugifyRoomKey(name, new Set(existing.map((r) => r.key)))

  const rows = (await sql`
    INSERT INTO building_rooms (key, name, points, is_assignable, sort, updated_by)
    VALUES (
      ${key}, ${name}, ${JSON.stringify(points)}::jsonb, ${is_assignable},
      coalesce((SELECT max(sort) + 10 FROM building_rooms), 0), ${actor}
    )
    RETURNING key
  `) as { key: string }[]

  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'create_room', ${key},
            ${JSON.stringify({ name, vertices: points.length, area: Math.round(area(points)) })})
  `

  return NextResponse.json({ key: rows[0].key }, { status: 201 })
}
