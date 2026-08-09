/**
 * Imports Washington County parcels that fall inside the ward boundary.
 * Idempotent — safe to re-run monthly when UGRC refreshes the county layer.
 *
 * The one invariant that matters: this script must never touch `households`,
 * `people` or the manual `in_ward` / `is_residential` overrides on `parcels`.
 * See scripts/test-import-clobber.ts.
 */
import type { Client } from 'pg'
import { withClient } from './lib/pg'
import { run } from './lib/run'

const SERVICE_URL =
  process.env.PARCEL_SERVICE_URL ??
  'https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Washington/FeatureServer/0'

const PAGE_SIZE = 2000

type Ring = [number, number][]

type ParcelProps = {
  PARCEL_ID?: string | null
  PARCEL_ADD?: string | null
  PARCEL_CITY?: string | null
  PARCEL_ZIP?: string | null
  ACCOUNT_NUM?: string | null
  OWN_TYPE?: string | null
  CoParcel_URL?: string | null
  ParcelsCur?: number | null
}

type Feature = {
  properties: ParcelProps
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } | null
}

/** Fetch every parcel intersecting the boundary, following the 2000-record cap. */
async function fetchParcels(esriRings: Ring[]): Promise<Feature[]> {
  const geometry = JSON.stringify({
    rings: esriRings,
    spatialReference: { wkid: 4326 },
  })
  const features: Feature[] = []

  for (let offset = 0; ; offset += PAGE_SIZE) {
    // POST, not GET: a 46-vertex ring serialized as Esri JSON blows past URL length limits (414).
    const body = new URLSearchParams({
      f: 'geojson',
      where: '1=1',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      geometry,
      geometryType: 'esriGeometryPolygon',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      resultRecordCount: String(PAGE_SIZE),
      resultOffset: String(offset),
    })

    const res = await fetch(`${SERVICE_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) throw new Error(`ArcGIS query failed: ${res.status} ${res.statusText}`)

    const page = (await res.json()) as {
      features?: Feature[]
      exceededTransferLimit?: boolean
      error?: { message: string }
    }
    if (page.error) throw new Error(`ArcGIS error: ${page.error.message}`)

    const batch = page.features ?? []
    features.push(...batch)
    console.log(`  page @${offset}: ${batch.length} features (total ${features.length})`)

    if (!page.exceededTransferLimit || batch.length === 0) break
  }

  return features
}

async function loadStaging(client: Client, features: Feature[]): Promise<number> {
  await client.query(`
    CREATE TEMP TABLE parcels_staging (
      parcel_id         text PRIMARY KEY,
      address           text,
      city              text,
      zip               text,
      account_num       text,
      own_type          text,
      coparcel_url      text,
      geom              geometry(MultiPolygon, 4326) NOT NULL,
      centroid          geometry(Point, 4326) NOT NULL,
      area_sqm          double precision,
      county_current_at timestamptz
    ) ON COMMIT DROP
  `)

  let loaded = 0

  for (let i = 0; i < features.length; i += 200) {
    const chunk = features.slice(i, i + 200)
    const values: unknown[] = []
    const tuples: string[] = []

    for (const f of chunk) {
      const p = f.properties
      const id = p.PARCEL_ID?.trim()
      if (!id || !f.geometry) continue // no stable join key, or geometry-less record

      const n = values.length
      // ST_Multi normalizes Polygon -> MultiPolygon; the service returns both.
      tuples.push(
        `($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},$${n + 6},$${n + 7},` +
          `ST_Multi(ST_MakeValid(ST_GeomFromGeoJSON($${n + 8}::text))),` +
          `ST_Centroid(ST_GeomFromGeoJSON($${n + 8}::text)),` +
          `ST_Area(ST_GeomFromGeoJSON($${n + 8}::text)::geography),` +
          `CASE WHEN $${n + 9}::bigint IS NULL THEN NULL ELSE to_timestamp($${n + 9}::bigint / 1000.0) END)`,
      )
      values.push(
        id,
        p.PARCEL_ADD?.trim() || null,
        p.PARCEL_CITY?.trim() || null,
        p.PARCEL_ZIP?.trim() || null,
        p.ACCOUNT_NUM?.trim() || null,
        p.OWN_TYPE?.trim() || null,
        p.CoParcel_URL?.trim() || null,
        JSON.stringify(f.geometry),
        p.ParcelsCur ?? null,
      )
    }
    if (tuples.length === 0) continue

    // ON CONFLICT: the county layer can return the same PARCEL_ID twice across
    // pages when a parcel has split geometry. Last one wins; they carry the same
    // attributes.
    await client.query(
      `INSERT INTO parcels_staging
         (parcel_id, address, city, zip, account_num, own_type, coparcel_url,
          geom, centroid, area_sqm, county_current_at)
       VALUES ${tuples.join(',')}
       ON CONFLICT (parcel_id) DO NOTHING`,
      values,
    )
    loaded += tuples.length
  }

  return loaded
}

run(() =>
  withClient(async (client) => {
    const boundary = await client.query<{ rings: string }>(
      // ForcePolygonCW: Esri expects clockwise exterior rings.
      `SELECT ST_AsGeoJSON(ST_ForcePolygonCW(geom)) AS rings FROM ward_boundary WHERE id = 1`,
    )
    if (boundary.rowCount === 0) {
      throw new Error('ward_boundary is empty — run `npm run seed:boundary` first.')
    }
    const esriRings = (JSON.parse(boundary.rows[0].rings) as { coordinates: Ring[] }).coordinates

    console.log('Fetching parcels from UGRC...')
    const features = await fetchParcels(esriRings)

    await client.query('BEGIN')
    try {
      const staged = await loadStaging(client, features)

      // Precise clip in PostGIS, not JS. ArcGIS `Intersects` catches parcels that
      // merely touch the boundary; centroid containment matches how people actually
      // think about "which ward is this house in".
      const clipped = await client.query(
        `DELETE FROM parcels_staging s
       USING ward_boundary w
       WHERE NOT ST_Contains(w.geom, s.centroid)`,
      )
      const kept = staged - (clipped.rowCount ?? 0)

      const upsert = await client.query<{ inserted: boolean }>(`
      INSERT INTO parcels (
        parcel_id, address, city, zip, account_num, own_type, coparcel_url,
        geom, centroid, area_sqm, county_current_at, imported_at, is_residential
      )
      SELECT
        parcel_id, address, city, zip, account_num, own_type, coparcel_url,
        geom, centroid, area_sqm, county_current_at, now(),
        (address IS NOT NULL AND btrim(address) <> '')
      FROM parcels_staging
      ON CONFLICT (parcel_id) DO UPDATE SET
        address           = EXCLUDED.address,
        city              = EXCLUDED.city,
        zip               = EXCLUDED.zip,
        account_num       = EXCLUDED.account_num,
        own_type          = EXCLUDED.own_type,
        coparcel_url      = EXCLUDED.coparcel_url,
        geom              = EXCLUDED.geom,
        centroid          = EXCLUDED.centroid,
        area_sqm          = EXCLUDED.area_sqm,
        county_current_at = EXCLUDED.county_current_at,
        imported_at       = EXCLUDED.imported_at
        -- in_ward and is_residential are deliberately absent: they are manual
        -- overrides and must survive every re-import.
      RETURNING (xmax = 0) AS inserted
    `)
      const inserted = upsert.rows.filter((r) => r.inserted).length
      const updated = upsert.rows.length - inserted

      // Parcels we hold that the county no longer returns inside the boundary.
      const stale = await client.query<{
        parcel_id: string
        address: string | null
        n: number
      }>(`
      SELECT p.parcel_id, p.address, count(h.id)::int AS n
      FROM parcels p
      LEFT JOIN households h ON h.parcel_id = p.parcel_id AND h.deleted_at IS NULL
      WHERE NOT EXISTS (SELECT 1 FROM parcels_staging s WHERE s.parcel_id = p.parcel_id)
      GROUP BY p.parcel_id, p.address
    `)
      const orphanedWithHouseholds = stale.rows.filter((r) => r.n > 0)
      const removable = stale.rows.filter((r) => r.n === 0).map((r) => r.parcel_id)

      let removed = 0
      if (removable.length > 0) {
        const del = await client.query(`DELETE FROM parcels WHERE parcel_id = ANY($1::text[])`, [
          removable,
        ])
        removed = del.rowCount ?? 0
      }

      const summary = await client.query<{
        total: number
        residential: number
        non_residential: number
      }>(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE is_residential)::int     AS residential,
             count(*) FILTER (WHERE NOT is_residential)::int AS non_residential
      FROM parcels
    `)

      await client.query('COMMIT')

      const s = summary.rows[0]
      console.log('\n--- import summary ---')
      console.log(`fetched from service      ${features.length}`)
      console.log(`staged (had PARCEL_ID)    ${staged}`)
      console.log(`kept after centroid clip  ${kept}`)
      console.log(`inserted                  ${inserted}`)
      console.log(`updated                   ${updated}`)
      console.log(`removed (stale, no data)  ${removed}`)
      console.log(`\nparcels total             ${s.total}`)
      console.log(`  residential             ${s.residential}`)
      console.log(
        `  non-residential         ${s.non_residential}   (blank PARCEL_ADD; hidden by default)`,
      )

      if (orphanedWithHouseholds.length > 0) {
        console.log(
          `\n!! ${orphanedWithHouseholds.length} parcel(s) with households no longer returned by the county.`,
        )
        console.log('   Kept in place — review by hand:')
        for (const r of orphanedWithHouseholds) {
          console.log(`   - ${r.parcel_id}  ${r.address ?? '(no address)'}  (${r.n} household(s))`)
        }
      }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  }),
)
