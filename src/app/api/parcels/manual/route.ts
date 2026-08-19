import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { authErrorResponse, requireSession } from '@/lib/auth'
import { PARCEL_USES } from '@/lib/types'

export const runtime = 'nodejs'

const Position = z.tuple([z.number().gte(-180).lte(180), z.number().gte(-90).lte(90)])

const Body = z.object({
  // Exterior ring, open or closed — the server closes it. Three distinct points
  // is the minimum that encloses any area.
  ring: z.array(Position).min(3).max(500),
  address: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v ? v : null)),
  use_type: z.enum(PARCEL_USES).default('residence'),
})

/**
 * Creates a hand-drawn parcel.
 *
 * Stored in `parcels` with source='manual' so it renders, accepts households and
 * opens in the detail panel exactly like a county parcel — while the monthly
 * import, which filters on source='county', leaves it alone.
 */
export async function POST(req: NextRequest) {
  let actor: string
  try {
    actor = (await requireSession()).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid parcel outline', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { ring, address, use_type } = parsed.data

  const closed = [...ring]
  const [fx, fy] = closed[0]
  const [lx, ly] = closed[closed.length - 1]
  if (fx !== lx || fy !== ly) closed.push([fx, fy])

  const geojson = JSON.stringify({ type: 'Polygon', coordinates: [closed] })

  // ST_MakeValid repairs the self-intersections a freehand trace produces;
  // ST_Multi matches the column type. A ring that encloses no area at all is
  // rejected rather than stored as an invisible parcel.
  const rows = (await sql`
    WITH g AS (
      SELECT ST_Multi(ST_MakeValid(ST_GeomFromGeoJSON(${geojson}::text))) AS geom
    )
    INSERT INTO parcels (
      parcel_id, address, geom, centroid, area_sqm, use_type, source, imported_at
    )
    SELECT
      'MANUAL-' || substr(gen_random_uuid()::text, 1, 8),
      ${address},
      geom,
      ST_Centroid(geom),
      ST_Area(geom::geography),
      ${use_type}::text::parcel_use,
      'manual',
      now()
    FROM g
    WHERE ST_Area(g.geom::geography) > 1
    RETURNING parcel_id
  `) as { parcel_id: string }[]

  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'That outline encloses no area. Add more points and try again.' },
      { status: 400 },
    )
  }

  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'create_manual_parcel', ${rows[0].parcel_id},
            ${JSON.stringify({ vertices: closed.length })})
  `

  return NextResponse.json({ parcel_id: rows[0].parcel_id }, { status: 201 })
}
