import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { requireSession } from '@/lib/auth'

export const runtime = 'nodejs'

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null))

const Patch = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  category: nullableText(80).optional(),
  notes: nullableText(2000).optional(),
})

/**
 * Edits one business tenant.
 *
 * Editing an imported row flips its source to 'manual': once a person has
 * corrected a name by hand, a later re-import has no business overwriting it.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let actor: string
  try {
    actor = (await requireSession()).name
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  const parsed = Patch.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid update', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const f = parsed.data
  // `null` means "clear this", absent means "leave it alone"; coalesce cannot
  // tell them apart, so nullable fields carry a present/absent flag.
  const has = (k: keyof typeof f) => k in f

  const updated = (await sql`
    UPDATE businesses SET
      name     = coalesce(${f.name ?? null}::text, name),
      category = CASE WHEN ${has('category')}::boolean
        THEN ${f.category ?? null}::text ELSE category END,
      notes = CASE WHEN ${has('notes')}::boolean
        THEN ${f.notes ?? null}::text ELSE notes END,
      source     = 'manual',
      updated_at = now(),
      updated_by = ${actor}
    WHERE id = ${id}
    RETURNING id, updated_at, updated_by
  `) as { id: string; updated_at: string; updated_by: string | null }[]

  if (updated.length === 0) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 })
  }

  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'update_business', ${id}, ${JSON.stringify({ fields: Object.keys(f) })})
  `

  return NextResponse.json({ ok: true, ...updated[0] })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let actor: string
  try {
    actor = (await requireSession()).name
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params

  // Hard delete: a business row is a shop name off a public map, not somebody's
  // contact details, and the audit row records that it was removed.
  const gone = (await sql`
    DELETE FROM businesses WHERE id = ${id} RETURNING parcel_id
  `) as { parcel_id: string }[]

  if (gone.length === 0) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 })
  }

  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'delete_business', ${id}, ${JSON.stringify({ parcel_id: gone[0].parcel_id })})
  `

  return NextResponse.json({ ok: true })
}
