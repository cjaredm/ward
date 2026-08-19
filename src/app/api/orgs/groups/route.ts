import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { authErrorResponse, requireSession } from '@/lib/auth'
import {
  buildMapGroups,
  type CallingMemberRow,
  type OrgMemberRow,
} from '@/lib/map-groups'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Every group of people the map can highlight, with the homes to highlight.
 *
 * `person_orgs` carries two kinds of row and both are wanted: the memberships the
 * callings import derives from who serves where, and the ones the roster import
 * reads off LCR's members report. `source` is what tells them apart downstream,
 * so it is selected rather than filtered on here.
 *
 * Sent whole rather than a lookup per selection. A ward's rosters are a few
 * hundred rows either side, so the entire index is smaller than one round trip's
 * latency budget — which makes switching groups on the map instant, and keeps it
 * working on the sort of phone signal this app is actually used on.
 *
 * The grouping itself is in @/lib/map-groups; this route is the query.
 */
export async function GET() {
  try {
    await requireSession()
  } catch (err) {
    return authErrorResponse(err)
  }

  const [orgRows, callingRows] = (await Promise.all([
    sql`
      SELECT po.org_key, po.unit, po.source, p.id AS person_id, p.full_name,
             h.id AS household_id, h.family_name, h.parcel_id
      FROM person_orgs po
      JOIN people p     ON p.id = po.person_id
      JOIN households h ON h.id = p.household_id AND h.deleted_at IS NULL
      ORDER BY h.family_name, p.sort_order, p.full_name
    `,
    sql`
      SELECT c.org_key, c.unit, c.name AS calling, p.id AS person_id, p.full_name,
             h.id AS household_id, h.family_name, h.parcel_id
      FROM callings c
      JOIN people p     ON p.id = c.person_id
      JOIN households h ON h.id = p.household_id AND h.deleted_at IS NULL
      WHERE c.released_at IS NULL
      ORDER BY c.org_key, c.unit, c.sort
    `,
  ])) as [OrgMemberRow[], CallingMemberRow[]]

  return NextResponse.json(
    { groups: buildMapGroups(orgRows, callingRows) },
    {
      headers: {
        // private, NOT s-maxage: this is member names and the properties they
        // live at, on a URL a shared cache would not vary by cookie.
        'Cache-Control': 'private, max-age=30, must-revalidate',
      },
    },
  )
}
