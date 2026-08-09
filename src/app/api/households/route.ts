import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { requireSession } from '@/lib/auth'
import { HOUSEHOLD_STATUSES } from '@/lib/types'

export const runtime = 'nodejs'

/**
 * A household is anchored either to a county parcel or to a dropped point.
 * Some homes have no parcel polygon at all; inventing synthetic parcels for
 * them would put them at war with the monthly import.
 */
const Body = z
  .object({
    parcel_id: z.string().min(1).optional(),
    lng: z.number().gte(-180).lte(180).optional(),
    lat: z.number().gte(-90).lte(90).optional(),
    family_name: z.string().trim().min(1).max(120).default('New household'),
    status: z.enum(HOUSEHOLD_STATUSES).default('unknown'),
    address: z
      .string()
      .trim()
      .max(200)
      .nullish()
      .transform((v) => (v ? v : null)),
  })
  .refine((b) => Boolean(b.parcel_id) !== (b.lng !== undefined && b.lat !== undefined), {
    message: 'Provide either parcel_id or both lng and lat, not both and not neither',
  })

export async function POST(req: NextRequest) {
  let actor: string
  try {
    actor = (await requireSession()).name
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid household', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { parcel_id, lng, lat, family_name, status, address } = parsed.data

  const rows = (await sql`
    INSERT INTO households (parcel_id, location, family_name, status, address, updated_by)
    VALUES (
      ${parcel_id ?? null},
      ${lng === undefined ? null : `SRID=4326;POINT(${lng} ${lat})`},
      ${family_name}, ${status}, ${address ?? null}, ${actor}
    )
    RETURNING id
  `) as { id: string }[]

  const id = rows[0].id
  // Audit records who and what, never the free-text PII payload.
  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'create_household', ${id},
            ${JSON.stringify({ anchor: parcel_id ? 'parcel' : 'point', parcel_id: parcel_id ?? null })})
  `

  return NextResponse.json({ id }, { status: 201 })
}
