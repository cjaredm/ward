import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { authErrorResponse, requireAdmin } from '@/lib/auth'
import { normalizeUrl, type QuickLink } from '@/lib/quick-links'
import { setShares, unknownUserIds } from '@/lib/quick-links-query'
import { Label, RawUrl, SharedWith } from './schema'

export const runtime = 'nodejs'

const Body = z.object({
  label: Label,
  url: RawUrl,
  /** Absent or empty means everybody; see migrations/0017_quick_link_shares.sql. */
  shared_with: SharedWith.optional(),
})

/**
 * Adds a link to the dashboard. Admin only — see migrations/0016_quick_links.sql
 * for why these are the ward's links and not each account's.
 *
 * The new row lands at the end, ten past the last one, which is where somebody
 * adding a link expects it to appear.
 */
export async function POST(req: NextRequest) {
  let actor: string
  try {
    actor = (await requireAdmin()).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid link', issues: parsed.error.issues }, { status: 400 })
  }

  const url = normalizeUrl(parsed.data.url)
  if (!url) {
    return NextResponse.json(
      { error: 'That does not look like a web address. It needs to be an http or https link.' },
      { status: 400 },
    )
  }

  const shared = parsed.data.shared_with ?? []
  const unknown = await unknownUserIds(shared)
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: 'One of the people this was shared with no longer has an account.' },
      { status: 400 },
    )
  }

  const rows = (await sql`
    INSERT INTO quick_links (label, url, sort, updated_by)
    VALUES (
      ${parsed.data.label}, ${url},
      (SELECT coalesce(max(sort), 0) + 10 FROM quick_links),
      ${actor}
    )
    RETURNING id::text, label, url, sort
  `) as Omit<QuickLink, 'shared_with'>[]

  // After the insert, so the shares have a link to hang off. A failure here
  // leaves a public link rather than a private one somebody thought was
  // narrowed — which is why the editor reads back what was stored.
  if (shared.length > 0) await setShares(rows[0].id, shared)

  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'create_quick_link', ${rows[0].id},
            ${JSON.stringify({ label: rows[0].label, url: rows[0].url, shared_with: shared })})
  `

  return NextResponse.json({ ...rows[0], shared_with: shared }, { status: 201 })
}
