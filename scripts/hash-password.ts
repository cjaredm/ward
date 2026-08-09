/**
 * Generates the bcrypt hash for WARD_APP_PASSWORD_HASH.
 *
 *   npm run hash-password -- 'the shared password'
 *
 * Also prints a fresh AUTH_JWT_SECRET so both secrets can be set in one pass.
 * Never store the plaintext password in an env var or commit it.
 */
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'

const password = process.argv[2]
if (!password) {
  console.error("Usage: npm run hash-password -- 'your shared password'")
  process.exit(1)
}
if (password.length < 12) {
  console.error(`Password is ${password.length} characters. Use at least 12 — this is the only credential guarding member addresses and phone numbers.`)
  process.exit(1)
}

const hash = await bcrypt.hash(password, 12)

console.log('\nAdd these to .env.local and to Vercel -> Settings -> Environment Variables:\n')
console.log(`WARD_APP_PASSWORD_HASH='${hash}'`)
console.log(`AUTH_JWT_SECRET='${randomBytes(32).toString('base64')}'`)
console.log('')
