/**
 * Applies migrations/*.sql in filename order, once each, inside a transaction.
 *
 * Deliberately NOT wired into the Vercel build: builds run on every preview and
 * can run concurrently, and concurrent schema migrations are how you corrupt a
 * database. Run this from a terminal before pushing code that needs it.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withClient } from './lib/pg'

const MIGRATIONS_DIR = join(process.cwd(), 'migrations')

await withClient(async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const applied = new Set(
    (await client.query<{ name: string }>('SELECT name FROM _migrations')).rows.map((r) => r.name),
  )

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  const pending = files.filter((f) => !applied.has(f))

  if (pending.length === 0) {
    console.log(`Up to date — ${files.length} migration(s) already applied.`)
    return
  }

  for (const file of pending) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    process.stdout.write(`Applying ${file} ... `)
    await client.query('BEGIN')
    try {
      // No parameters -> simple query protocol -> multiple statements per file are fine.
      await client.query(sql)
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file])
      await client.query('COMMIT')
      console.log('ok')
    } catch (err) {
      await client.query('ROLLBACK')
      console.log('FAILED')
      throw err
    }
  }

  console.log(`Applied ${pending.length} migration(s).`)
})
