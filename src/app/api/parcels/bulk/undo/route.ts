import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { requireSession } from '@/lib/auth'

export const runtime = 'nodejs'

const Body = z.object({ undo_id: z.union([z.string(), z.number()]).optional() })

/**
 * Reverts a bulk parcel update using the before-state captured in its audit row.
 *
 * With no undo_id, reverts the most recent bulk update. Restores use_type and
 * in_ward exactly as they were, per parcel. Audit rows written before businesses
 * moved to their own table also carry a business_name, which is simply ignored.
 */
export async function POST(req: NextRequest) {
  let actor: string
  try {
    actor = (await requireSession()).name
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = Body.safeParse((await req.json().catch(() => null)) ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const undoId = parsed.data.undo_id ?? null

  const found = (await sql`
    SELECT id, at, actor, diff->'prior' AS prior
    FROM audit_log
    WHERE action = 'bulk_update_parcels'
      AND diff ? 'prior'
      AND (${undoId}::text IS NULL OR id = ${undoId}::bigint)
    ORDER BY at DESC
    LIMIT 1
  `) as { id: string; at: string; actor: string; prior: unknown }[]

  if (found.length === 0 || !found[0].prior) {
    return NextResponse.json(
      { error: 'No reversible bulk change found. Updates made before undo existed cannot be replayed.' },
      { status: 404 },
    )
  }

  const restored = (await sql`
    UPDATE parcels p SET
      use_type      = (b->>'use_type')::parcel_use,
      in_ward       = (b->>'in_ward')::boolean
    FROM jsonb_array_elements(${JSON.stringify(found[0].prior)}::jsonb) AS b
    WHERE p.parcel_id = b->>'parcel_id'
    RETURNING p.parcel_id
  `) as { parcel_id: string }[]

  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'undo_bulk_update', ${found[0].id},
            ${JSON.stringify({ restored: restored.length, original_at: found[0].at, original_actor: found[0].actor })})
  `

  return NextResponse.json({ restored: restored.length, original_at: found[0].at })
}
