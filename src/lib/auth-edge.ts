// Edge-safe half of auth: JWT only, no next/headers, no bcrypt.
// Imported by middleware.ts, which runs on the Edge runtime.
//
// Subpath imports rather than the `jose` barrel: the barrel pulls in JWE
// decryption, which references CompressionStream and warns on the Edge runtime.
import { SignJWT } from 'jose/jwt/sign'
import { jwtVerify } from 'jose/jwt/verify'

export const COOKIE_NAME = 'ward_session'
export const MAX_AGE = 60 * 60 * 24 * 7 // 7 days

export type Session = { name: string }

function secret(): Uint8Array {
  const s = process.env.AUTH_JWT_SECRET
  if (!s) throw new Error('AUTH_JWT_SECRET is not set')
  return new TextEncoder().encode(s)
}

export async function signSession(session: Session): Promise<string> {
  return new SignJWT({ name: session.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret())
}

export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    const name = typeof payload.name === 'string' ? payload.name : null
    return name ? { name } : null
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
