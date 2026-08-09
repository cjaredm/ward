import { NextResponse, type NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { COOKIE_NAME, cookieOptions, signSession } from '@/lib/auth'
import { resolvePasswordHash } from '@/lib/password'

export const runtime = 'nodejs'

const Body = z.object({
  password: z.string().min(1),
  name: z.string().trim().min(2).max(60),
})

/**
 * In-memory rate limit. Vercel functions are ephemeral so this resets on cold
 * start, which is fine at 5-15 users: it blunts a naive loop without pretending
 * to be a real limiter.
 */
const attempts = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 10

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  entry.count++
  return entry.count > MAX_ATTEMPTS
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  let hash: string
  try {
    hash = resolvePasswordHash()
  } catch (err) {
    // Loud and specific: a mangled hash otherwise presents as "Incorrect
    // password" forever, with nothing to debug from.
    console.error(err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: 'Server password is not configured correctly. Check the server logs.' },
      { status: 500 },
    )
  }

  // Never log the parsed body — it carries the shared password.
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter your name and the password.' }, { status: 400 })
  }

  const ok = await bcrypt.compare(parsed.data.password, hash)
  if (!ok) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 })
  }

  const token = await signSession({ name: parsed.data.name })
  const res = NextResponse.json({ ok: true, name: parsed.data.name })
  res.cookies.set(COOKIE_NAME, token, cookieOptions())
  return res
}
