import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { authErrorResponse, requireSession } from '@/lib/auth'
import { MAX_PHOTO_URL, safePhotoUrl } from '@/lib/photo'
import { HOUSEHOLD_STATUSES } from '@/lib/types'

export const runtime = 'nodejs'

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null))

const PersonInput = z.object({
  id: z.uuid().optional(),
  full_name: z.string().trim().min(1).max(120),
  /**
   * A link to a picture, not a file. Validated rather than merely length-checked
   * because it is rendered as an <img src>: `safePhotoUrl` rejects anything that
   * is not https, and an unparseable or http URL becomes null instead of failing
   * the whole household -- a bad paste in one field must not lose the edit.
   */
  photo_url: z
    .string()
    .trim()
    .max(MAX_PHOTO_URL)
    .nullish()
    .transform((v) => safePhotoUrl(v)),
})

const Patch = z
  .object({
    family_name: z.string().trim().min(1).max(120).optional(),
    status: z.enum(HOUSEHOLD_STATUSES).optional(),
    notes: nullableText(4000).optional(),
    // Only meaningful for pinned households; parcel-backed ones show the county address.
    address: nullableText(200).optional(),
    people: z.array(PersonInput).max(30).optional(),
    // Dragging a pin to the right house. Pairs only — half a coordinate is a bug.
    lng: z.number().gte(-180).lte(180).optional(),
    lat: z.number().gte(-90).lte(90).optional(),
    /**
     * Re-anchoring a household between the two ways it can be located.
     *
     * A string attaches it to that parcel and drops its point — the household
     * stops being a loose pin and becomes one of the families living at that
     * address. `null` does the reverse: the parcel is released and the household
     * falls back to a point, defaulting to the parcel's centroid so it lands on
     * the house it just left rather than somewhere the user has to hunt for.
     *
     * Absent means "leave the anchor alone", which is every other PATCH.
     */
    parcel_id: z.string().min(1).nullable().optional(),
  })
  .refine((b) => (b.lng === undefined) === (b.lat === undefined), {
    message: 'lng and lat must be sent together',
  })
  // Attaching to a parcel clears the point, so a point sent with it would be
  // silently thrown away.
  .refine((b) => !(typeof b.parcel_id === 'string' && b.lng !== undefined), {
    message: 'parcel_id and a point cannot be set together',
  })

/**
 * One household with its people, shaped like ParcelDetail so the panel can render
 * a pinned household (no parcel behind it) with the same component.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSession()
  } catch (err) {
    return authErrorResponse(err)
  }

  const { id } = await ctx.params
  const rows = (await sql`
    SELECT jsonb_build_object(
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
            'id', pe.id, 'full_name', pe.full_name, 'photo_url', pe.photo_url,
            'callings', coalesce((
              SELECT jsonb_agg(jsonb_build_object(
                       'id', c.id, 'org_key', c.org_key, 'name', c.name,
                       'unit', c.unit, 'is_custom', c.is_custom
                     ) ORDER BY c.sort)
              FROM callings c WHERE c.person_id = pe.id AND c.released_at IS NULL
            ), '[]'::jsonb),
            'orgs', coalesce((
              SELECT jsonb_agg(DISTINCT po.org_key ORDER BY po.org_key)
              FROM person_orgs po WHERE po.person_id = pe.id
            ), '[]'::jsonb),
            'sort_order', pe.sort_order
          ) ORDER BY pe.sort_order, pe.full_name
        ) FROM people pe WHERE pe.household_id = h.id
      ), '[]'::jsonb)
    ) AS household
    FROM households h
    WHERE h.id = ${id} AND h.deleted_at IS NULL
  `) as { household: unknown }[]

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Household not found' }, { status: 404 })
  }

  return NextResponse.json(
    // A pinned household has no parcel, so it can carry no business tenants.
    { parcel: null, households: [rows[0].household], businesses: [] },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let actor: string
  try {
    actor = (await requireSession()).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const { id } = await ctx.params
  const parsed = Patch.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid update', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { people, lng, lat, parcel_id, ...fields } = parsed.data
  // `null` is a meaningful value here, so presence is what decides whether the
  // anchor moves at all — `parcel_id ?? undefined` would erase the difference.
  const reanchor = 'parcel_id' in parsed.data
  const attaching = typeof parcel_id === 'string'
  const detaching = reanchor && parcel_id === null

  const current = (await sql`
    SELECT parcel_id FROM households WHERE id = ${id} AND deleted_at IS NULL
  `) as { parcel_id: string | null }[]
  if (current.length === 0) {
    return NextResponse.json({ error: 'Household not found' }, { status: 404 })
  }

  // The FK would catch this, but as a 500 rather than something the map can show.
  if (attaching) {
    const target = (await sql`
      SELECT 1 FROM parcels WHERE parcel_id = ${parcel_id}
    `) as unknown[]
    if (target.length === 0) {
      return NextResponse.json({ error: 'Parcel not found' }, { status: 404 })
    }
  }

  // Detaching falls back to the parcel's centroid for the new point, so a
  // household with no parcel to leave has nowhere to land — and dropping the
  // anchor entirely would violate households_anchored_ck.
  if (detaching && !current[0].parcel_id && lng === undefined) {
    return NextResponse.json(
      { error: 'Household is not attached to a parcel' },
      { status: 400 },
    )
  }

  // Every write is a batch known upfront, so the HTTP driver's non-interactive
  // transaction is sufficient — no connection pool needed.
  const statements = []

  // Nullable fields need a present/absent flag alongside the value: `null` means
  // "clear this", absent means "leave it alone", and coalesce cannot tell them apart.
  const has = (k: keyof typeof fields) => k in fields
  statements.push(sql`
    UPDATE households SET
      family_name = coalesce(${fields.family_name ?? null}::text, family_name),
      status      = coalesce(${fields.status ?? null}::text::household_status, status),
      notes = CASE WHEN ${has('notes')}::boolean
        THEN ${fields.notes ?? null}::text ELSE notes END,
      address = CASE WHEN ${has('address')}::boolean
        THEN ${fields.address ?? null}::text ELSE address END,
      parcel_id = CASE WHEN ${reanchor}::boolean
        THEN ${parcel_id ?? null}::text ELSE parcel_id END,
      -- Only a pinned household can move. A parcel-backed one is located by its
      -- polygon, and giving it a point as well would put a second marker on the
      -- map for the same family -- which is also why attaching drops the point.
      location = CASE
        WHEN ${attaching}::boolean THEN NULL
        WHEN ${lng ?? null}::double precision IS NOT NULL
             AND (parcel_id IS NULL OR ${detaching}::boolean)
          THEN ST_SetSRID(ST_MakePoint(${lng ?? null}, ${lat ?? null}), 4326)
        -- Detaching with no point given: land on the parcel being left, so the
        -- pin appears on the house rather than somewhere off screen.
        WHEN ${detaching}::boolean
          THEN (SELECT p.centroid FROM parcels p WHERE p.parcel_id = households.parcel_id)
        ELSE location END,
      updated_at = now(),
      updated_by = ${actor}
    WHERE id = ${id}
  `)

  if (people) {
    const keepIds = people.map((p) => p.id).filter((v): v is string => Boolean(v))
    statements.push(sql`
      DELETE FROM people
      WHERE household_id = ${id} AND NOT (id = ANY(${keepIds}::uuid[]))
    `)
    people.forEach((p, i) => {
      if (p.id) {
        statements.push(sql`
          UPDATE people
          SET full_name = ${p.full_name}, sort_order = ${i}, photo_url = ${p.photo_url ?? null}
          WHERE id = ${p.id} AND household_id = ${id}
        `)
      } else {
        statements.push(sql`
          INSERT INTO people (household_id, full_name, sort_order, photo_url)
          VALUES (${id}, ${p.full_name}, ${i}, ${p.photo_url ?? null})
        `)
      }
    })
  }

  // Field names only, never values: the audit trail must not become a second
  // copy of the PII that "Delete this household" is supposed to erase.
  const changed = Object.keys(fields)
    .concat(people ? ['people'] : [])
    .concat(lng === undefined ? [] : ['location'])
    .concat(reanchor ? ['parcel_id'] : [])
  statements.push(sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'update_household', ${id}, ${JSON.stringify({
      fields: changed,
      // Parcel ids are county identifiers, not PII, so the anchor change is
      // recorded in full -- it is the one edit worth being able to trace back.
      ...(reanchor ? { anchor: attaching ? 'parcel' : 'point', parcel_id: parcel_id ?? null } : {}),
    })})
  `)

  await sql.transaction(statements)

  const updated = (await sql`
    SELECT updated_at, updated_by FROM households WHERE id = ${id}
  `) as { updated_at: string; updated_by: string | null }[]

  return NextResponse.json({ ok: true, ...updated[0] })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let actor: string
  try {
    actor = (await requireSession()).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const { id } = await ctx.params

  // Hard-delete the people rows: a removal request means the names are gone,
  // not flagged. The household row is soft-deleted
  // so the audit trail still shows that something was here and who removed it.
  await sql.transaction([
    sql`DELETE FROM people WHERE household_id = ${id}`,
    sql`UPDATE households SET deleted_at = now(), updated_at = now(), updated_by = ${actor},
         notes = NULL
         WHERE id = ${id} AND deleted_at IS NULL`,
    sql`INSERT INTO audit_log (actor, action, entity_id, diff)
        VALUES (${actor}, 'delete_household', ${id}, '{}'::jsonb)`,
  ])

  return NextResponse.json({ ok: true })
}
