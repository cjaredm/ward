import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { authErrorResponse, requireAdmin } from '@/lib/auth'
import { normalizeUrl, type QuickLink } from '@/lib/quick-links'
import { setShares, unknownUserIds } from '@/lib/quick-links-query'
import { Label, RawUrl, SharedWith, UUID } from '../schema'

export const runtime = 'nodejs'

const Body = z.object({
  label: Label.optional(),
  url: RawUrl.optional(),
  /** The whole audience, replacing what is stored. Empty means everybody. */
  shared_with: SharedWith.optional(),
  sort: z.number().int().optional(),
})

/** The stored audience, for the audit diff and for the response. */
async function sharesOf(id: string): Promise<string[]> {
  const rows = (await sql`
    SELECT user_id::text FROM quick_link_shares
    WHERE link_id = ${id}::uuid ORDER BY created_at
  `) as { user_id: string }[]
  return rows.map((r) => r.user_id)
}

/**
 * Renames a link, repoints it, or changes who it is for. Admin only.
 *
 * The id is checked against the uuid shape before it reaches the query: a
 * `::uuid` cast on a string that is not one raises a Postgres error, and a
 * malformed id in the path is a 404, not a 500.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let actor: string
  try {
    actor = (await requireAdmin()).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const { id } = await ctx.params
  if (!UUID.test(id)) return NextResponse.json({ error: 'No such link' }, { status: 404 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid change', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const body = parsed.data

  let url: string | null = null
  if (body.url !== undefined) {
    url = normalizeUrl(body.url)
    if (!url) {
      return NextResponse.json(
        { error: 'That does not look like a web address. It needs to be an http or https link.' },
        { status: 400 },
      )
    }
  }

  if (body.shared_with !== undefined) {
    const unknown = await unknownUserIds(body.shared_with)
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: 'One of the people this was shared with no longer has an account.' },
        { status: 400 },
      )
    }
  }

  const before = (await sql`
    SELECT id::text, label, url, sort FROM quick_links WHERE id = ${id}::uuid
  `) as Omit<QuickLink, 'shared_with'>[]
  if (before.length === 0) return NextResponse.json({ error: 'No such link' }, { status: 404 })
  const sharedBefore = await sharesOf(id)

  const rows = (await sql`
    UPDATE quick_links SET
      label      = coalesce(${body.label ?? null}, label),
      url        = coalesce(${url}, url),
      sort       = coalesce(${body.sort ?? null}, sort),
      updated_at = now(),
      updated_by = ${actor}
    WHERE id = ${id}::uuid
    RETURNING id::text, label, url, sort
  `) as Omit<QuickLink, 'shared_with'>[]

  // Left alone when the field is absent: a PATCH that only renames a link must
  // not quietly reopen it to the whole ward.
  if (body.shared_with !== undefined) await setShares(id, body.shared_with)
  const sharedAfter = body.shared_with ?? sharedBefore

  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'update_quick_link', ${id},
            ${JSON.stringify({
              from: { ...before[0], shared_with: sharedBefore },
              to: { ...rows[0], shared_with: sharedAfter },
            })})
  `

  return NextResponse.json({ ...rows[0], shared_with: sharedAfter })
}

/**
 * Removes a link. Its shares go with it — the foreign key cascades, and a share
 * has no meaning without the link it is about.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let actor: string
  try {
    actor = (await requireAdmin()).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const { id } = await ctx.params
  if (!UUID.test(id)) return NextResponse.json({ error: 'No such link' }, { status: 404 })

  const shared = await sharesOf(id)

  const rows = (await sql`
    DELETE FROM quick_links WHERE id = ${id}::uuid
    RETURNING id::text, label, url, sort
  `) as Omit<QuickLink, 'shared_with'>[]
  if (rows.length === 0) return NextResponse.json({ error: 'No such link' }, { status: 404 })

  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'delete_quick_link', ${id},
            ${JSON.stringify({ label: rows[0].label, url: rows[0].url, shared_with: shared })})
  `

  return NextResponse.json({ ok: true })
}
