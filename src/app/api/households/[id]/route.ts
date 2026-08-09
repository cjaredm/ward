import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { requireSession } from '@/lib/auth'
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
  role: nullableText(30),
  phone: nullableText(40),
  email: nullableText(200),
})

const Patch = z.object({
  family_name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(HOUSEHOLD_STATUSES).optional(),
  notes: nullableText(4000).optional(),
  // Only meaningful for pinned households; parcel-backed ones show the county address.
  address: nullableText(200).optional(),
  people: z.array(PersonInput).max(30).optional(),
})

/**
 * One household with its people, shaped like ParcelDetail so the panel can render
 * a pinned household (no parcel behind it) with the same component.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSession()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
            'id', pe.id, 'full_name', pe.full_name, 'role', pe.role,
            'phone', pe.phone, 'email', pe.email, 'sort_order', pe.sort_order
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
    { parcel: null, households: [rows[0].household] },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

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
  const { people, ...fields } = parsed.data

  const exists = (await sql`
    SELECT 1 FROM households WHERE id = ${id} AND deleted_at IS NULL
  `) as unknown[]
  if (exists.length === 0) {
    return NextResponse.json({ error: 'Household not found' }, { status: 404 })
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
          UPDATE people SET full_name = ${p.full_name}, role = ${p.role ?? null},
            phone = ${p.phone ?? null}, email = ${p.email ?? null}, sort_order = ${i}
          WHERE id = ${p.id} AND household_id = ${id}
        `)
      } else {
        statements.push(sql`
          INSERT INTO people (household_id, full_name, role, phone, email, sort_order)
          VALUES (${id}, ${p.full_name}, ${p.role ?? null}, ${p.phone ?? null}, ${p.email ?? null}, ${i})
        `)
      }
    })
  }

  // Field names only, never values: the audit trail must not become a second
  // copy of the PII that "Delete this household" is supposed to erase.
  const changed = Object.keys(fields).concat(people ? ['people'] : [])
  statements.push(sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'update_household', ${id}, ${JSON.stringify({ fields: changed })})
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
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params

  // Hard-delete the people rows: a removal request means the names, phone
  // numbers and emails are gone, not flagged. The household row is soft-deleted
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
