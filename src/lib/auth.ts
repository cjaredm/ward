// Node-runtime half of auth. Re-exports the Edge-safe pieces so route handlers
// have one import, and adds the cookie-reading helper.
import { cookies } from 'next/headers'
import { COOKIE_NAME, verifySession, type Session } from './auth-edge'

export { COOKIE_NAME, MAX_AGE, cookieOptions, signSession, verifySession } from './auth-edge'
export type { Session } from './auth-edge'

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

/**
 * Middleware has already rejected unauthenticated requests, but every handler
 * re-verifies server-side. A client-side check is never the gate on data this
 * sensitive, and middleware matchers are easy to get subtly wrong.
 */
export async function requireSession(): Promise<Session> {
  const session = await verifySession((await cookies()).get(COOKIE_NAME)?.value)
  if (!session) throw new UnauthorizedError()
  return session
}
