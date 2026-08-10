import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { requireSession } from '@/lib/auth'
import { PARCEL_USES, type ParcelDetail } from '@/lib/types'

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
        'use_type', p.use_type,
        'business_name', p.business_name,
        'source', p.source
      ) AS parcel,
      coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', h.id,
            'parcel_id', h.parcel_id,
            'family_name', h.family_name,
            'status', h.status,
            'notes', h.notes,
            'address', h.address,
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

  return NextResponse.json(rows[0], { headers: { 'Cache-Control': 'private, no-store' } })
}

const Patch = z.object({
  use_type: z.enum(PARCEL_USES).optional(),
  business_name: z
    .string()
    .trim()
    .max(160)
    .nullish()
    .transform((v) => (v ? v : null))
    .optional(),
  in_ward: z.boolean().optional(),
})

/**
 * Ward-side overrides on a county parcel: what the property is used for, a
 * business name, and whether it counts as inside the ward at all.
 *
 * These three columns are the only ones on `parcels` the app writes, and the
 * monthly import is written to preserve them. Everything else on this table is
 * county data and is refreshed wholesale.
 *
 * Stamping ward_edited_at is what stops the import from ever deleting this
 * parcel, even if a redrawn boundary puts it out of range. Classifying parcels
 * by hand is the slowest work in this app; it does not get thrown away because
 * an outline moved.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ parcelId: string }> }) {
  let actor: string
  try {
    actor = (await requireSession()).name
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { parcelId } = await ctx.params
  const parsed = Patch.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid update', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const f = parsed.data
  const has = (k: keyof typeof f) => k in f

  const updated = (await sql`
    UPDATE parcels SET
      use_type      = coalesce(${f.use_type ?? null}::text::parcel_use, use_type),
      in_ward       = coalesce(${f.in_ward ?? null}::boolean, in_ward),
      business_name = CASE WHEN ${has('business_name')}::boolean
        THEN ${f.business_name ?? null}::text ELSE business_name END,
      ward_edited_at = now()
    WHERE parcel_id = ${parcelId}
    RETURNING parcel_id
  `) as { parcel_id: string }[]

  if (updated.length === 0) {
    return NextResponse.json({ error: 'Parcel not found' }, { status: 404 })
  }

  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'update_parcel', ${parcelId}, ${JSON.stringify({ fields: Object.keys(f) })})
  `

  return NextResponse.json({ ok: true })
}

/**
 * Deletes a hand-drawn parcel.
 *
 * County parcels are not deletable here — they are owned by the monthly import
 * and would reappear on the next run anyway. A drawn parcel with households on
 * it is refused rather than cascaded: those rows hold names and phone numbers,
 * and removing them should be a deliberate act, not a side effect of tidying up
 * an outline.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ parcelId: string }> }) {
  let actor: string
  try {
    actor = (await requireSession()).name
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { parcelId } = await ctx.params

  const rows = (await sql`
    SELECT p.source,
           (SELECT count(*)::int FROM households h
             WHERE h.parcel_id = p.parcel_id AND h.deleted_at IS NULL) AS households
    FROM parcels p WHERE p.parcel_id = ${parcelId}
  `) as { source: string; households: number }[]

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Parcel not found' }, { status: 404 })
  }
  if (rows[0].source !== 'manual') {
    return NextResponse.json(
      { error: 'County parcels cannot be deleted. Mark it as a common area instead.' },
      { status: 403 },
    )
  }
  if (rows[0].households > 0) {
    return NextResponse.json(
      {
        error: `Delete the ${rows[0].households} household(s) on this parcel first.`,
      },
      { status: 409 },
    )
  }

  await sql`DELETE FROM parcels WHERE parcel_id = ${parcelId} AND source = 'manual'`
  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'delete_manual_parcel', ${parcelId}, '{}'::jsonb)
  `

  return NextResponse.json({ ok: true })
}
