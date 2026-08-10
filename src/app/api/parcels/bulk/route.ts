import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { requireSession } from '@/lib/auth'
import { PARCEL_USES } from '@/lib/types'

export const runtime = 'nodejs'

const Body = z.object({
  parcel_ids: z.array(z.string().min(1)).min(1).max(1000),
  use_type: z.enum(PARCEL_USES).optional(),
  in_ward: z.boolean().optional(),
})

/**
 * Applies one ward-side override to many parcels at once.
 *
 * Marking a commercial strip one parcel at a time is the slowest part of setting
 * this map up, and every click is a round trip. This is a single statement.
 *
 * Business names are deliberately NOT settable here: they are per-parcel, and a
 * bulk write would stamp the same one across a whole selection.
 *
 * The audit row records each parcel's PRIOR use_type and in_ward, not just a
 * count. One mis-aimed box select can retype a hundred parcels, and without the
 * before-state there is nothing to undo from — which is exactly how a batch of
 * hand-classified parcels got lost once already. /api/parcels/bulk/undo replays it.
 */
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
      { error: 'Invalid bulk update', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { parcel_ids, use_type, in_ward } = parsed.data

  if (use_type === undefined && in_ward === undefined) {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
  }

  const rows = (await sql`
    WITH before AS (
      SELECT parcel_id, use_type::text AS use_type, in_ward
      FROM parcels WHERE parcel_id = ANY(${parcel_ids}::text[])
    ),
    updated AS (
      UPDATE parcels SET
        use_type = coalesce(${use_type ?? null}::text::parcel_use, use_type),
        in_ward  = coalesce(${in_ward ?? null}::boolean, in_ward),
        -- Marks these as carrying ward work, so a redrawn boundary can never
        -- delete them out from under the person who classified them.
        ward_edited_at = now()
      WHERE parcel_id = ANY(${parcel_ids}::text[])
      RETURNING parcel_id
    )
    SELECT (SELECT count(*)::int FROM updated) AS n,
           (SELECT jsonb_agg(to_jsonb(b)) FROM before b) AS prior
  `) as { n: number; prior: unknown }[]

  const { n, prior } = rows[0]

  const logged = (await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'bulk_update_parcels', ${`${n} parcels`},
            ${JSON.stringify({ count: n, use_type: use_type ?? null, in_ward: in_ward ?? null })}::jsonb
            || jsonb_build_object('prior', ${JSON.stringify(prior)}::jsonb))
    RETURNING id
  `) as { id: string }[]

  return NextResponse.json({ updated: n, undo_id: logged[0].id })
}
