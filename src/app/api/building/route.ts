import { NextResponse } from 'next/server'
import { authErrorResponse, requireSection } from '@/lib/auth'
import { readBuilding } from '@/lib/building-query'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The whole building map: rooms, the blocks a Sunday is divided into, every
 * assignment, and the classes available to link an assignment to.
 *
 * One response rather than four endpoints — see src/lib/building-query.ts. The
 * client re-reads this after every write, the way WardMap re-reads /api/parcels.
 */
export async function GET() {
  try {
    await requireSection('building')
  } catch (err) {
    return authErrorResponse(err)
  }

  const data = await readBuilding()

  return NextResponse.json(data, {
    headers: {
      // private, NOT s-maxage: a shared CDN cache would hold this keyed on a URL
      // it does not vary by cookie, and the class links name organizations.
      'Cache-Control': 'private, max-age=30, must-revalidate',
    },
  })
}
