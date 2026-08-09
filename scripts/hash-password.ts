/**
 * Generates the value for WARD_APP_PASSWORD_HASH.
 *
 *   npm run hash-password -- 'the shared password'
 *
 * Prints the bcrypt hash base64-encoded. That is not decoration: Next.js runs
 * dotenv-expand over .env files, and a raw bcrypt hash starts with `$2b$12$`,
 * which expands to nothing and silently truncates the value — every login then
 * fails with "Incorrect password" while the password is actually fine. Base64
 * contains no `$`, so one value works byte-identically in .env, .env.local and
 * the Vercel dashboard.
 *
 * Also prints a fresh AUTH_JWT_SECRET so both secrets can be set in one pass.
 * Never store the plaintext password anywhere — not in an env var, not in a
 * comment next to the hash.
 */
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { run } from './lib/run'

run(async () => {
  const password = process.argv[2]
  if (!password) {
    throw new Error("Usage: npm run hash-password -- 'your shared password'")
  }
  if (password.length < 12) {
    throw new Error(
      `Password is ${password.length} characters. Use at least 12 — this is the only credential ` +
        'guarding member addresses and phone numbers.',
    )
  }

  const hash = await bcrypt.hash(password, 12)
  const encoded = Buffer.from(hash, 'utf8').toString('base64')

  console.log('\nAdd these to .env.local and to Vercel -> Settings -> Environment Variables.')
  console.log('Paste them exactly as printed — no quotes needed, no escaping needed.\n')
  console.log(`WARD_APP_PASSWORD_HASH=${encoded}`)
  console.log(`AUTH_JWT_SECRET=${randomBytes(32).toString('base64')}`)
  console.log('\nDo not keep the plaintext password in the file alongside these.\n')
})
