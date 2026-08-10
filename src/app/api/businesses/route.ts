import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { requireSession } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * A business tenant on a parcel. Many per parcel: one industrial unit on
 * Hillcrest Dr holds six of them.
 *
 * Unlike a household this is always anchored to a parcel — a business with no
 * county polygon behind it has never come up, and a dropped pin models a home.
 */
const Body = z.object({
  parcel_id: z.string().min(1),
  name: z.string().trim().min(1).max(160).default('New business'),
  category: z
    .string()
    .trim()
    .max(80)
    .nullish()
    .transform((v) => (v ? v : null)),
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
      { error: 'Invalid business', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { parcel_id, name, category } = parsed.data

  const parcel = (await sql`
    SELECT parcel_id FROM parcels WHERE parcel_id = ${parcel_id}
  `) as { parcel_id: string }[]
  if (parcel.length === 0) {
    return NextResponse.json({ error: 'Parcel not found' }, { status: 404 })
  }

  const rows = (await sql`
    INSERT INTO businesses (parcel_id, name, category, sort_order, updated_by)
    VALUES (
      ${parcel_id}, ${name}, ${category},
      (SELECT coalesce(max(sort_order) + 1, 0) FROM businesses WHERE parcel_id = ${parcel_id}),
      ${actor}
    )
    RETURNING id
  `) as { id: string }[]

  const id = rows[0].id
  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'create_business', ${id}, ${JSON.stringify({ parcel_id })})
  `

  return NextResponse.json({ id }, { status: 201 })
}
