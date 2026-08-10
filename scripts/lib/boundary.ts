/**
 * geojson.json — the hand-traced ward boundary — and how it gets into the
 * database.
 *
 * The file is the source of truth for the boundary. Editing it and running the
 * sync is the whole workflow for redrawing the ward; nothing else writes
 * `ward_boundary`.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Client } from 'pg'

export const BOUNDARY_FILE = join(process.cwd(), 'geojson.json')

type Pos = [number, number]

type Feature = { geometry: { type: string; coordinates: unknown } }

/**
 * Pulls a closed exterior ring out of the traced file.
 *
 * The export is a LineString whose last vertex lands ~1.2 m from its first (a
 * hand-tracing artifact) plus a stray Point marker, so the ring is closed here
 * and the Point ignored. A Polygon feature is accepted too, for whenever the
 * drawing tool decides to emit one.
 */
export function ringFrom(features: Feature[]): Pos[] {
  const polygon = features.find((f) => f.geometry.type === 'Polygon')
  const line = features.find((f) => f.geometry.type === 'LineString')

  let ring: Pos[]
  if (polygon) {
    ring = (polygon.geometry.coordinates as Pos[][])[0].slice()
  } else if (line) {
    ring = (line.geometry.coordinates as Pos[]).slice()
  } else {
    throw new Error(
      `${BOUNDARY_FILE} contains no LineString or Polygon feature to use as the boundary`,
    )
  }

  const [fx, fy] = ring[0]
  const [lx, ly] = ring[ring.length - 1]
  if (fx !== lx || fy !== ly) ring.push([fx, fy])

  if (ring.length < 4) throw new Error(`boundary ring has only ${ring.length} vertices`)
  return ring
}

export type BoundarySource = {
  /** The ring as a GeoJSON Polygon, ready for ST_GeomFromGeoJSON. */
  geojson: string
  /** SHA-256 of the file's bytes. The change detector for the build-time sync. */
  sha: string
  vertices: number
}

export async function readBoundarySource(file = BOUNDARY_FILE): Promise<BoundarySource> {
  const raw = await readFile(file)
  const parsed = JSON.parse(raw.toString('utf8')) as { features: Feature[] }
  const ring = ringFrom(parsed.features)
  return {
    geojson: JSON.stringify({ type: 'Polygon', coordinates: [ring] }),
    // Hash the bytes, not the derived ring: any edit to the file — including one
    // that turns out to be a no-op — should show up as "changed" exactly once.
    sha: createHash('sha256').update(raw).digest('hex'),
    vertices: ring.length,
  }
}

export type StoredBoundary = {
  srid: number
  valid: boolean
  reason: string | null
  area_sqkm: string
  vertices: number
}

/** Writes the singleton boundary row and validates what PostGIS made of it. */
export async function writeBoundary(
  client: Client,
  source: BoundarySource,
  updatedBy: string,
): Promise<StoredBoundary> {
  const { rows } = await client.query<StoredBoundary>(
    `
    WITH g AS (
      SELECT ST_ForcePolygonCCW(ST_MakeValid(ST_GeomFromGeoJSON($1::text))) AS geom
    )
    INSERT INTO ward_boundary (id, geom, updated_by, source_sha)
    SELECT 1, geom, $2, $3 FROM g
    ON CONFLICT (id) DO UPDATE
      SET geom = EXCLUDED.geom, updated_at = now(),
          updated_by = EXCLUDED.updated_by, source_sha = EXCLUDED.source_sha
    RETURNING
      ST_SRID(geom)                  AS srid,
      ST_IsValid(geom)               AS valid,
      ST_IsValidReason(geom)         AS reason,
      ST_Area(geom::geography) / 1e6 AS area_sqkm,
      ST_NPoints(geom)               AS vertices
  `,
    [source.geojson, updatedBy, source.sha],
  )

  const b = rows[0]
  if (b.srid !== 4326) throw new Error(`boundary stored with SRID ${b.srid}, expected 4326`)
  if (!b.valid) throw new Error(`boundary geometry is invalid: ${b.reason}`)
  return b
}

/** The SHA the stored boundary was built from, or null if it predates tracking. */
export async function storedSha(client: Client): Promise<string | null | undefined> {
  const { rows } = await client.query<{ source_sha: string | null }>(
    `SELECT source_sha FROM ward_boundary WHERE id = 1`,
  )
  return rows.length === 0 ? undefined : rows[0].source_sha
}
