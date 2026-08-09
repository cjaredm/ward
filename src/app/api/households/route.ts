import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { requireSession } from '@/lib/auth'
import { HOUSEHOLD_STATUSES } from '@/lib/types'

export const runtime = 'nodejs'

const Body = z.object({
  parcel_id: z.string().min(1),
  family_name: z.string().trim().min(1).max(120),
  status: z.enum(HOUSEHOLD_STATUSES).default('unknown'),
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
  const { parcel_id, family_name, status } = parsed.data

  const rows = (await sql`
    INSERT INTO households (parcel_id, family_name, status, updated_by)
    VALUES (${parcel_id}, ${family_name}, ${status}, ${actor})
    RETURNING id
  `) as { id: string }[]

  const id = rows[0].id
  // Audit records who and what, never the free-text PII payload.
  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'create_household', ${id}, ${JSON.stringify({ parcel_id, family_name, status })})
  `

  return NextResponse.json({ id }, { status: 201 })
}
