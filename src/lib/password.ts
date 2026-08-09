const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

/**
 * Resolves WARD_APP_PASSWORD_HASH, accepting either a base64-encoded bcrypt
 * hash (preferred) or a raw one.
 *
 * Why base64 is preferred: Next.js runs dotenv-expand over .env files, and a
 * bcrypt hash starts with `$2b$12$`. Those read as variable references and
 * expand to nothing, so a raw hash silently loads as a truncated string and
 * every login fails with "Incorrect password" — the password is fine, the hash
 * is gone. Escaping each `$` fixes .env but Vercel's dashboard stores values
 * literally, so the same secret would need two different forms. Base64 has no
 * `$` in it and is byte-identical everywhere.
 */
export function resolvePasswordHash(): string {
  const raw = process.env.WARD_APP_PASSWORD_HASH
  if (!raw) throw new Error('WARD_APP_PASSWORD_HASH is not set')

  if (BCRYPT_RE.test(raw)) return raw

  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8')
    if (BCRYPT_RE.test(decoded)) return decoded
  } catch {
    // fall through to the error below
  }

  throw new Error(
    'WARD_APP_PASSWORD_HASH is not a valid bcrypt hash. ' +
      `Got ${raw.length} characters starting "${raw.slice(0, 4)}". ` +
      'If you pasted a raw hash into a .env file, the leading $2b$12$ was eaten by ' +
      'variable expansion — re-run `npm run hash-password` and use the base64 value it prints.',
  )
}
