/**
 * Upload endpoint for LCR's "Member List" PDF — names and addresses.
 *
 * Same shape as the callings upload: the first call previews the plan, the
 * second applies it, and the file is parsed fresh both times so an apply can
 * only ever write the plan the admin was shown. The file is never written to
 * disk.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { authErrorResponse, requireAdmin } from '@/lib/auth'
import { parseMemberReport } from '@/lib/import/members'
import { applyMembersPlan, buildMembersPlan } from '@/lib/import/members-plan'
import { extractLines } from '@/lib/import/pdf'

export const runtime = 'nodejs'
// 26 pages, ~560 members, each matched against every person in the ward.
export const maxDuration = 60

const MAX_BYTES = 15 * 1024 * 1024

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
    return NextResponse.json({ error: 'Attach the member list PDF as `file`.' }, { status: 400 })
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That file is empty or too large.' }, { status: 400 })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') {
    return NextResponse.json({ error: 'That is not a PDF.' }, { status: 400 })
  }

  let plan
  try {
    const parsed = parseMemberReport(await extractLines(bytes))
    if (parsed.rows.length === 0) {
      return NextResponse.json(
        {
          error:
            'No members found in that PDF. It should be the "Member List" report out of LCR — the one with a name and an address per row.',
        },
        { status: 422 },
      )
    }
    plan = await buildMembersPlan(parsed)
  } catch (err) {
    console.error('member import failed', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not read that PDF.' },
      { status: 422 },
    )
  }

  const apply = form?.get('apply') === '1'
  const result = apply ? await applyMembersPlan(plan, actor, file.name || null) : null

  return NextResponse.json(
    { applied: apply, plan, linkedCallings: result?.linkedCallings ?? 0 },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
