/**
 * Creates the first admin account, or any account, from a terminal.
 *
 *   npm run create-user -- jared@example.com 'Jared Mortenson' --admin
 *
 * Every other account is made from /admin/users inside the app. This script
 * exists for the one that cannot be: the first admin, before anybody can sign
 * in at all. It also gets you back in if the last admin is ever locked out.
 *
 * A temporary password is generated and printed once. The account is flagged
 * must_change_password, so it is replaced at first sign-in and never has to be
 * stored anywhere.
 */
import { randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { generateTempPassword } from '../src/lib/temp-password'
import { withClient } from './lib/pg'
import { run } from './lib/run'

const BCRYPT_ROUNDS = 12

run(async () => {
  const args = process.argv.slice(2)
  const isAdmin = args.includes('--admin')
  const positional = args.filter((a) => !a.startsWith('--'))
  const [emailArg, nameArg] = positional
  const permissions = (args.find((a) => a.startsWith('--permissions='))?.split('=')[1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (!emailArg || !nameArg) {
    throw new Error(
      "Usage: npm run create-user -- <email> '<Full Name>' [--admin] [--permissions=map]",
    )
  }

  const email = emailArg.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(`"${emailArg}" does not look like an email address.`)
  }
  if (!isAdmin && permissions.length === 0) {
    console.warn(
      '! No --admin and no --permissions, so this account will sign in and see an empty dashboard.',
    )
  }

  const password = generateTempPassword((bound) => randomInt(bound))
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS)

  await withClient(async (client) => {
    const existing = await client.query('SELECT id FROM users WHERE lower(email) = $1', [email])
    if (existing.rowCount) {
      throw new Error(`${email} already has an account. Reset it from /admin/users instead.`)
    }

    await client.query(
      `INSERT INTO users (email, name, password_hash, is_admin, permissions, updated_by)
       VALUES ($1, $2, $3, $4, $5, 'scripts/create-user')`,
      [email, nameArg.trim(), hash, isAdmin, permissions],
    )
  })

  console.log(`\nCreated ${isAdmin ? 'admin ' : ''}account for ${nameArg.trim()} <${email}>.`)
  console.log('\nTemporary password — printed once, not recoverable:\n')
  console.log(`  ${password}\n`)
  console.log('They must change it the first time they sign in. Do not store it anywhere.\n')
})
