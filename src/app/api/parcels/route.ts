import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireSession } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The whole ward as one GeoJSON FeatureCollection.
 *
 * ~500 parcels serialize to roughly 260 KB, 32 KB gzipped, so this ships in a
 * single request and goes straight into MapLibre as a `geojson` source.
 * Deliberately no vector tiles and no ST_AsMVT — a tile pyramid here solves a
 * problem that does not exist at this scale.
 *
 * Two kinds of feature come back, distinguished by `properties.kind`:
 *   'parcel'  county polygons
 *   'pin'     households at addresses the county has no parcel for
 *
 * Assembled in PostGIS rather than JS so the payload is never materialized as
 * JS objects on the way through.
 */
export async function GET() {
  try {
    await requireSession()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rows = (await sql`
    WITH parcel_features AS (
      SELECT jsonb_build_object(
        'type', 'Feature',
        'id', p.parcel_id,
        -- 6 decimal places is ~11 cm; anything finer is noise that doubles the payload.
        'geometry', ST_AsGeoJSON(ST_ReducePrecision(p.geom, 0.000001))::jsonb,
        'properties', jsonb_build_object(
          'kind', 'parcel',
          'source', p.source,
          -- Also carried as a property, not just the feature id: MapLibre style
          -- expressions handle ['get','pid'] with non-numeric ids more reliably
          -- than ['id'], and PARCEL_ID looks like 'W-SSR-4-402'.
          'pid', p.parcel_id,
          'address', p.address,
          'use', p.use_type,
          'businessName', p.business_name,
          'familyName', h.family_name,
          'status', h.status,
          'householdCount', coalesce(h.n, 0)
        )
      ) AS f
      FROM parcels p
      LEFT JOIN LATERAL (
        SELECT family_name, status, count(*) OVER () AS n
        FROM households
        WHERE parcel_id = p.parcel_id AND deleted_at IS NULL
        ORDER BY created_at
        LIMIT 1
      ) h ON true
      WHERE p.in_ward
    ),
    pin_features AS (
      SELECT jsonb_build_object(
        'type', 'Feature',
        'id', h.id,
        'geometry', ST_AsGeoJSON(ST_ReducePrecision(h.location, 0.000001))::jsonb,
        'properties', jsonb_build_object(
          'kind', 'pin',
          'hid', h.id,
          'familyName', h.family_name,
          'status', h.status,
          'address', h.address
        )
      ) AS f
      FROM households h
      WHERE h.location IS NOT NULL AND h.deleted_at IS NULL
    )
    SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', coalesce(jsonb_agg(f), '[]'::jsonb)
    ) AS fc
    FROM (SELECT f FROM parcel_features UNION ALL SELECT f FROM pin_features) t
  `) as { fc: unknown }[]

  return NextResponse.json(rows[0]?.fc ?? { type: 'FeatureCollection', features: [] }, {
    headers: {
      // private, NOT s-maxage. A shared CDN cache would hold member names,
      // addresses and phone numbers keyed on a URL the CDN does not vary by cookie.
      'Cache-Control': 'private, max-age=30, must-revalidate',
    },
  })
}
