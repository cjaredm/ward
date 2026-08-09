import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireSession } from '@/lib/auth'
import type { ParcelDetail } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Full detail for one parcel: read-only county fields plus every household on it. */
export async function GET(_req: Request, ctx: { params: Promise<{ parcelId: string }> }) {
  try {
    await requireSession()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { parcelId } = await ctx.params

  const rows = (await sql`
    SELECT
      jsonb_build_object(
        'parcel_id', p.parcel_id,
        'address', p.address,
        'city', p.city,
        'zip', p.zip,
        'own_type', p.own_type,
        'coparcel_url', p.coparcel_url,
        'in_ward', p.in_ward,
        'is_residential', p.is_residential
      ) AS parcel,
      coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', h.id,
            'parcel_id', h.parcel_id,
            'family_name', h.family_name,
            'status', h.status,
            'notes', h.notes,
            'updated_at', h.updated_at,
            'updated_by', h.updated_by,
            'people', coalesce((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', pe.id, 'full_name', pe.full_name, 'role', pe.role,
                  'phone', pe.phone, 'email', pe.email, 'sort_order', pe.sort_order
                ) ORDER BY pe.sort_order, pe.full_name
              ) FROM people pe WHERE pe.household_id = h.id
            ), '[]'::jsonb)
          ) ORDER BY h.created_at
        )
        FROM households h
        WHERE h.parcel_id = p.parcel_id AND h.deleted_at IS NULL
      ), '[]'::jsonb) AS households
    FROM parcels p
    WHERE p.parcel_id = ${parcelId}
  `) as unknown as ParcelDetail[]

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Parcel not found' }, { status: 404 })
  }

  return NextResponse.json(rows[0], {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
