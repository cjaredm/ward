/**
 * Loads geojson.json into the ward_boundary singleton row.
 *
 * The traced file is a LineString whose last vertex lands ~1.2 m from its first
 * (a hand-tracing artifact), plus a stray Point feature. Close the ring, drop
 * the Point, and let PostGIS validate the result.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withClient } from './lib/pg'
import { run } from './lib/run'

type Pos = [number, number]

const SOURCE = join(process.cwd(), 'geojson.json')

/** Pulls a closed exterior ring out of the traced file. */
function ringFrom(features: { geometry: { type: string; coordinates: unknown } }[]): Pos[] {
  const polygon = features.find((f) => f.geometry.type === 'Polygon')
  const line = features.find((f) => f.geometry.type === 'LineString')

  let ring: Pos[]
  if (polygon) {
    ring = (polygon.geometry.coordinates as Pos[][])[0].slice()
  } else if (line) {
    ring = (line.geometry.coordinates as Pos[]).slice()
  } else {
    throw new Error(`${SOURCE} contains no LineString or Polygon feature to use as the boundary`)
  }

  const [fx, fy] = ring[0]
  const [lx, ly] = ring[ring.length - 1]
  if (fx !== lx || fy !== ly) ring.push([fx, fy])

  if (ring.length < 4) throw new Error(`boundary ring has only ${ring.length} vertices`)
  return ring
}

run(async () => {
  const raw = JSON.parse(await readFile(SOURCE, 'utf8')) as {
    features: { geometry: { type: string; coordinates: unknown } }[]
  }
  const geojson = JSON.stringify({
    type: 'Polygon',
    coordinates: [ringFrom(raw.features)],
  })

  await withClient(async (client) => {
    const { rows } = await client.query<{
      srid: number
      valid: boolean
      reason: string | null
      area_sqkm: string
      vertices: number
    }>(
      `
      WITH g AS (
        SELECT ST_ForcePolygonCCW(ST_MakeValid(ST_GeomFromGeoJSON($1::text))) AS geom
      )
      INSERT INTO ward_boundary (id, geom, updated_by)
      SELECT 1, geom, 'seed-boundary.ts' FROM g
      ON CONFLICT (id) DO UPDATE
        SET geom = EXCLUDED.geom, updated_at = now(), updated_by = EXCLUDED.updated_by
      RETURNING
        ST_SRID(geom)                  AS srid,
        ST_IsValid(geom)               AS valid,
        ST_IsValidReason(geom)         AS reason,
        ST_Area(geom::geography) / 1e6 AS area_sqkm,
        ST_NPoints(geom)               AS vertices
    `,
      [geojson],
    )

    const b = rows[0]
    if (b.srid !== 4326) throw new Error(`boundary stored with SRID ${b.srid}, expected 4326`)
    if (!b.valid) throw new Error(`boundary geometry is invalid: ${b.reason}`)

    console.log(
      `Boundary seeded — ${b.vertices} vertices, ${Number(b.area_sqkm).toFixed(2)} km², SRID ${b.srid}, valid.`,
    )
  })
})
