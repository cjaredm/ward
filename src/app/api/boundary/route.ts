import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { authErrorResponse, requireSession } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The ward boundary polygon, plus its bbox so the map can fit on first paint. */
export async function GET() {
  try {
    await requireSession()
  } catch (err) {
    return authErrorResponse(err)
  }

  const rows = (await sql`
    SELECT ST_AsGeoJSON(geom)::jsonb AS geometry,
           ARRAY[ST_XMin(geom), ST_YMin(geom), ST_XMax(geom), ST_YMax(geom)] AS bbox
    FROM ward_boundary WHERE id = 1
  `) as { geometry: unknown; bbox: number[] }[]

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No ward boundary set' }, { status: 404 })
  }

  return NextResponse.json(
    {
      type: 'Feature',
      geometry: rows[0].geometry,
      properties: {},
      bbox: rows[0].bbox,
    },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  )
}
