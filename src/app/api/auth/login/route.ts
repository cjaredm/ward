import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { COOKIE_NAME, cookieOptions, signSession } from '@/lib/auth'
import { recordLogin, verifyCredentials } from '@/lib/users'

export const runtime = 'nodejs'

const Body = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
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

  // Never log the parsed body — it carries a password.
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 })
  }

  const user = await verifyCredentials(parsed.data.email, parsed.data.password)
  if (!user) {
    // One message for wrong password, unknown address and deactivated account
    // alike, so the form cannot be used to enumerate who has access.
    return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 })
  }

  await recordLogin(user.id)

  const token = await signSession({ sub: user.id, name: user.name })
  const res = NextResponse.json({
    ok: true,
    name: user.name,
    mustChangePassword: user.must_change_password,
  })
  res.cookies.set(COOKIE_NAME, token, cookieOptions())
  return res
}
