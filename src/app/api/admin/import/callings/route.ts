/**
 * Upload endpoint for LCR's "Organizations and Callings" PDF.
 *
 * Two calls, same file: the first previews the plan, the second applies it. The
 * plan is not stored between them — the file is re-parsed — so there is no
 * server-side state to expire and no way for an apply to write a plan the admin
 * never saw. The file itself is never written to disk.
 *
 * Admin-only. This rewrites callings across the whole ward in one request.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { authErrorResponse, requireAdmin } from '@/lib/auth'
import { sql } from '@/lib/db'
import { parseCallingsReport } from '@/lib/import/callings'
import { applyCallingsPlan, buildCallingsPlan } from '@/lib/import/callings-plan'
import { extractLines } from '@/lib/import/pdf'

export const runtime = 'nodejs'
// Parsing 14 pages and matching ~350 names against the ward takes a few seconds.
export const maxDuration = 60

/** LCR's report is ~200 KB. Anything far past that is not this report. */
const MAX_BYTES = 15 * 1024 * 1024

export async function GET() {
  try {
    await requireAdmin()
  } catch (err) {
    return authErrorResponse(err)
  }

  const batches = (await sql`
    SELECT id, kind, file_name, stats, actor, created_at
    FROM import_batches ORDER BY created_at DESC LIMIT 10
  `) as unknown[]

  return NextResponse.json({ batches }, { headers: { 'Cache-Control': 'private, no-store' } })
}

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
    return NextResponse.json({ error: 'Attach the callings PDF as `file`.' }, { status: 400 })
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
    const parsed = parseCallingsReport(await extractLines(bytes))
    if (parsed.rows.length === 0) {
      return NextResponse.json(
        {
          error:
            'No callings found in that PDF. It should be the "Organizations and Callings" report out of LCR.',
        },
        { status: 422 },
      )
    }
    plan = await buildCallingsPlan(parsed)
  } catch (err) {
    console.error('callings import failed to parse', err)
    return NextResponse.json({ error: 'Could not read that PDF.' }, { status: 422 })
  }

  const apply = form?.get('apply') === '1'
  if (apply) await applyCallingsPlan(plan, actor, file.name || null)

  return NextResponse.json(
    { applied: apply, plan },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
