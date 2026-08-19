// Edge-safe half of auth: JWT only, no next/headers, no bcrypt, no database.
// Imported by middleware.ts, which runs on the Edge runtime.
//
// Subpath imports rather than the `jose` barrel: the barrel pulls in JWE
// decryption, which references CompressionStream and warns on the Edge runtime.
import { SignJWT } from 'jose/jwt/sign'
import { jwtVerify } from 'jose/jwt/verify'

export const COOKIE_NAME = 'ward_session'
export const MAX_AGE = 60 * 60 * 24 * 7 // 7 days

/**
 * What the cookie carries: identity only.
 *
 * Permissions, admin status and whether the account is still active are
 * deliberately NOT in here. A 7-day token would keep asserting them for a week
 * after an admin revoked them. `requireUser()` reads those from the database on
 * every request instead, so a change takes effect on the next click.
 */
export type Session = {
  /** users.id */
  sub: string
  /** users.name — the display name written into updated_by and audit_log.actor. */
  name: string
}

function secret(): Uint8Array {
  const s = process.env.AUTH_JWT_SECRET
  if (!s) throw new Error('AUTH_JWT_SECRET is not set')
  return new TextEncoder().encode(s)
}

export async function signSession(session: Session): Promise<string> {
  return new SignJWT({ name: session.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.sub)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret())
}

export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    const sub = typeof payload.sub === 'string' ? payload.sub : null
    const name = typeof payload.name === 'string' ? payload.name : null
    return sub && name ? { sub, name } : null
  } catch {
    return null
  }
}

export function cookieOptions(maxAge = MAX_AGE) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge,
  }
}
