import { config } from 'dotenv'
import { Client } from 'pg'

config({ path: '.env.local', quiet: true })
config({ quiet: true })

/**
 * Scripts talk to Neon over a plain TCP connection using the DIRECT (unpooled)
 * connection string. The pooled endpoint routes through PgBouncer in transaction
 * mode, which breaks multi-statement DDL, temp tables and session state — all of
 * which the migration and import scripts rely on.
 *
 * The app runtime uses @neondatabase/serverless over HTTP instead; see src/lib/db.ts.
 */
export function directUrl(): string {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL_UNPOOLED is not set. Copy the DIRECT (non -pooler) Neon connection string into .env.local.',
    )
  }
  if (url.includes('-pooler')) {
    console.warn(
      '! DATABASE_URL_UNPOOLED points at the pooled endpoint (-pooler). ' +
        'Migrations and imports need the direct endpoint; expect failures.',
    )
  }
  return url
}

export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: directUrl() })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}
