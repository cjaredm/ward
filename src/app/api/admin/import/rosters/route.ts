/**
 * Upload endpoint for the members variant of LCR's "Organizations and Callings"
 * PDF — the one that prints a roster per organization and class.
 *
 * Two calls, same file: the first previews the plan, the second applies it. The
 * plan is not stored between them — the file is re-parsed — so there is no
 * server-side state to expire and no way for an apply to write a plan the admin
 * never saw. The file itself is never written to disk.
 *
 * Admin-only. This rewrites organization membership across the whole ward.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { authErrorResponse, requireAdmin } from '@/lib/auth'
import { parseRosterReport } from '@/lib/import/rosters'
import { applyRostersPlan, buildRostersPlan } from '@/lib/import/rosters-plan'
import { extractLines } from '@/lib/import/pdf'

export const runtime = 'nodejs'
// 26 pages and ~1,300 names matched against the ward takes a few seconds.
export const maxDuration = 60

/** LCR's report is a few hundred KB. Anything far past that is not this report. */
const MAX_BYTES = 15 * 1024 * 1024

const WRONG_REPORT =
  'No rosters found in that PDF. It should be the "Organizations and Callings" report with ' +
  'members included — the one whose sections read "Elders Quorum Members", "Gatherers of Light ' +
  'Members" and so on. The callings-only version goes in the box above.'

export async function POST(req: NextRequest) {
  let actor: string
  try {
    actor = (await requireAdmin()).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Attach the roster PDF as `file`.' }, { status: 400 })
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That file is empty or too large.' }, { status: 400 })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  // Magic number rather than the browser-supplied content type.
  if (String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') {
    return NextResponse.json({ error: 'That is not a PDF.' }, { status: 400 })
  }

  let plan
  try {
    const parsed = parseRosterReport(await extractLines(bytes))
    if (parsed.rows.length === 0) {
      return NextResponse.json({ error: WRONG_REPORT }, { status: 422 })
    }
    plan = await buildRostersPlan(parsed)
  } catch (err) {
    console.error('roster import failed to parse', err)
    return NextResponse.json({ error: 'Could not read that PDF.' }, { status: 422 })
  }

  const apply = form?.get('apply') === '1'
  if (apply) await applyRostersPlan(plan, actor, file.name || null)

  return NextResponse.json(
    { applied: apply, plan },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
