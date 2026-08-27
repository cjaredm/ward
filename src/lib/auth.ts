// Node-runtime half of auth. Re-exports the Edge-safe pieces so route handlers
// have one import, and resolves the cookie into a live user row.
import { cache } from 'react'
import { cookies } from 'next/headers'
import { COOKIE_NAME, verifySession, type Session } from './auth-edge'
import { canEdit, canSee } from './permissions'
import { findUserById, type User } from './users'

export { COOKIE_NAME, MAX_AGE, cookieOptions, signSession, verifySession } from './auth-edge'
export type { Session } from './auth-edge'
export type { User } from './users'

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

/**
 * The signed-in user, or null.
 *
 * The cookie proves identity; everything that governs access — admin, section
 * permissions, whether the account still exists at all — is read fresh from the
 * database here. That is what makes revocation immediate rather than pending
 * until a 7-day token expires. `cache` collapses the repeat reads a single
 * request makes (layout, page, handler) into one query.
 */
export const currentUser = cache(async (): Promise<User | null> => {
  const session: Session | null = await verifySession((await cookies()).get(COOKIE_NAME)?.value)
  if (!session) return null
  const user = await findUserById(session.sub)
  return user?.is_active ? user : null
})

export async function requireUser(): Promise<User> {
  const user = await currentUser()
  if (!user) throw new UnauthorizedError()
  return user
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser()
  if (!user.is_admin) throw new ForbiddenError('Admins only')
  return user
}

export async function requireSection(section: string): Promise<User> {
  const user = await requireUser()
  if (!canSee(user, section)) throw new ForbiddenError(`No access to ${section}`)
  return user
}

/**
 * The gate on a write, where a section separates reading from changing.
 *
 * Every handler that mutates calls this instead of `requireSection`. Hiding the
 * buttons is not a permission system — a read-only account still holds a cookie
 * that can POST — so the two go together and this one is the one that counts.
 */
export async function requireSectionEdit(section: string): Promise<User> {
  const user = await requireUser()
  if (!canEdit(user, section)) throw new ForbiddenError(`Cannot change ${section}`)
  return user
}

/**
 * Middleware has already rejected unauthenticated requests, but every handler
 * re-verifies server-side. A client-side check is never the gate on data this
 * sensitive, and middleware matchers are easy to get subtly wrong.
 *
 * Ward data lives behind the map section, so that is the permission every one
 * of those handlers needs. `.name` stays the actor string written into
 * updated_by and audit_log — now supplied by the account rather than typed into
 * the login form.
 */
export async function requireSession(): Promise<User> {
  return requireSection('map')
}

/**
 * Turns a thrown auth error into the response every route handler returns for
 * it, so a signed-in user who simply lacks a section gets 403 rather than a 401
 * the client would read as "your session expired" and bounce to /login over.
 */
export function authErrorResponse(err: unknown): Response {
  const status = err instanceof ForbiddenError ? 403 : 401
  return Response.json({ error: status === 403 ? 'Forbidden' : 'Unauthorized' }, { status })
}
