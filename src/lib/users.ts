import bcrypt from 'bcryptjs'
import { sql } from './db'

/** bcrypt work factor. Matches what scripts/create-user.ts writes. */
export const BCRYPT_ROUNDS = 12

/**
 * Rules for a password somebody chooses and has to remember: 8 characters with
 * upper case, lower case and one symbol. Short enough to be memorable, mixed
 * enough that the obvious guesses do not fit.
 *
 * Temporary passwords an admin hands out are not bound by this — they are
 * random and never memorized, so they answer to TEMP_PASSWORD_MIN_LENGTH.
 */
export const MIN_PASSWORD_LENGTH = 8

/**
 * Length floor for an admin-set temporary password, independent of the rules
 * above. The word passphrase in lib/temp-password always clears it comfortably;
 * this is here so nothing else can post a short one to the admin routes.
 */
export const TEMP_PASSWORD_MIN_LENGTH = 16

export const PASSWORD_RULES =
  'At least 8 characters, with an upper case letter, a lower case letter and one symbol.'

/**
 * Returns the first unmet rule, or null when the password is acceptable. Used
 * by the change-password route so the message says what is actually missing.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (!/[a-z]/.test(password)) return 'Include a lower case letter.'
  if (!/[A-Z]/.test(password)) return 'Include an upper case letter.'
  if (!/[^A-Za-z0-9]/.test(password)) return 'Include one symbol, such as ! ? # or $.'
  return null
}

export type User = {
  id: string
  email: string
  name: string
  is_admin: boolean
  permissions: string[]
  must_change_password: boolean
  is_active: boolean
  last_login_at: string | null
  created_at: string
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export async function findUserById(id: string): Promise<User | null> {
  const rows = (await sql`SELECT id, email, name, is_admin, permissions, must_change_password,
                                 is_active, last_login_at, created_at
                          FROM users WHERE id = ${id}`) as User[]
  return rows[0] ?? null
}

/**
 * Verifies an email/password pair.
 *
 * Returns null for "no such email", "wrong password" and "deactivated" alike —
 * the caller has one failure message for all three, so a stranger cannot use
 * the login form to learn which addresses have accounts.
 *
 * The bcrypt comparison runs even when the email is unknown. Skipping it would
 * make unknown addresses answer measurably faster than known ones.
 */
// A real bcrypt hash of a throwaway string, so the unknown-email path spends the
// same ~200ms in bcrypt that a known one does.
const DUMMY_HASH = '$2b$12$kDSCGI3WgA4Re5akFpVGXeiyMgenqoPc18uU1yzHR5iWJnXEcS856'

export async function verifyCredentials(email: string, password: string): Promise<User | null> {
  const rows = (await sql`SELECT id, email, name, is_admin, permissions, must_change_password,
                                 is_active, last_login_at, created_at, password_hash
                          FROM users WHERE lower(email) = ${normalizeEmail(email)}`) as (User & {
    password_hash: string
  })[]

  const row = rows[0]
  const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH)
  if (!row || !ok || !row.is_active) return null

  // The hash never leaves this module.
  delete (row as Partial<typeof row>).password_hash
  return row
}

export async function verifyPasswordFor(id: string, password: string): Promise<boolean> {
  const rows = (await sql`SELECT password_hash FROM users WHERE id = ${id}`) as {
    password_hash: string
  }[]
  if (!rows[0]) return false
  return bcrypt.compare(password, rows[0].password_hash)
}

export async function recordLogin(id: string): Promise<void> {
  await sql`UPDATE users SET last_login_at = now() WHERE id = ${id}`
}

export async function listUsers(): Promise<User[]> {
  return (await sql`SELECT id, email, name, is_admin, permissions, must_change_password,
                           is_active, last_login_at, created_at
                    FROM users ORDER BY is_active DESC, lower(name)`) as User[]
}

export type NewUser = {
  email: string
  name: string
  password: string
  is_admin: boolean
  permissions: string[]
}

export async function createUser(input: NewUser, actor: string): Promise<User> {
  const rows = (await sql`
    INSERT INTO users (email, name, password_hash, is_admin, permissions, updated_by)
    VALUES (${normalizeEmail(input.email)}, ${input.name.trim()},
            ${await hashPassword(input.password)}, ${input.is_admin},
            ${input.permissions}, ${actor})
    RETURNING id, email, name, is_admin, permissions, must_change_password,
              is_active, last_login_at, created_at
  `) as User[]
  return rows[0]
}

export type UserPatch = {
  name?: string
  email?: string
  is_admin?: boolean
  permissions?: string[]
  is_active?: boolean
}

/**
 * Partial update without string-concatenating SQL.
 *
 * The Neon HTTP driver is tagged-template only, so each column is written by
 * its own statement rather than assembled into one dynamic SET clause. At one
 * admin editing one user at a time the extra round trips do not matter, and
 * nothing here is ever built from a caller-supplied identifier.
 */
export async function updateUser(id: string, patch: UserPatch, actor: string): Promise<void> {
  if (patch.name !== undefined) {
    await sql`UPDATE users SET name = ${patch.name.trim()} WHERE id = ${id}`
  }
  if (patch.email !== undefined) {
    await sql`UPDATE users SET email = ${normalizeEmail(patch.email)} WHERE id = ${id}`
  }
  if (patch.is_admin !== undefined) {
    await sql`UPDATE users SET is_admin = ${patch.is_admin} WHERE id = ${id}`
  }
  if (patch.permissions !== undefined) {
    await sql`UPDATE users SET permissions = ${patch.permissions} WHERE id = ${id}`
  }
  if (patch.is_active !== undefined) {
    await sql`UPDATE users SET is_active = ${patch.is_active} WHERE id = ${id}`
  }
  await sql`UPDATE users SET updated_at = now(), updated_by = ${actor} WHERE id = ${id}`
}

/**
 * Admin-initiated reset: the new password is temporary by construction, so the
 * account is flagged and every page bounces to /change-password until the owner
 * picks their own.
 */
export async function resetPassword(id: string, password: string, actor: string): Promise<void> {
  await sql`
    UPDATE users
    SET password_hash = ${await hashPassword(password)},
        must_change_password = true,
        updated_at = now(),
        updated_by = ${actor}
    WHERE id = ${id}
  `
}

/** The owner choosing their own password — clears the forced-change flag. */
export async function setOwnPassword(id: string, password: string): Promise<void> {
  await sql`
    UPDATE users
    SET password_hash = ${await hashPassword(password)},
        must_change_password = false,
        updated_at = now()
    WHERE id = ${id}
  `
}

/** True when this is the last admin who can still sign in. */
export async function isLastActiveAdmin(id: string): Promise<boolean> {
  const rows = (await sql`
    SELECT count(*)::int AS n FROM users WHERE is_admin AND is_active AND id <> ${id}
  `) as { n: number }[]
  return rows[0].n === 0
}
