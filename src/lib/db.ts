import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

/**
 * App runtime uses the Neon HTTP driver against the POOLED connection string.
 *
 * HTTP, not WebSockets/Pool: every write in this app is a batch known upfront
 * (update household -> replace people rows -> insert audit row), which
 * `sql.transaction([...])` covers. That avoids pool lifecycle management and
 * connection exhaustion inside ephemeral serverless functions.
 *
 * Scripts use a plain pg TCP client on the DIRECT string instead; see scripts/lib/pg.ts.
 */
let cached: NeonQueryFunction<false, false> | null = null

function client(): NeonQueryFunction<false, false> {
  if (!cached) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    cached = neon(url)
  }
  return cached
}

// Lazy so that `next build` does not require DATABASE_URL at module-import time.
export const sql: NeonQueryFunction<false, false> = new Proxy(
  (() => {}) as unknown as NeonQueryFunction<false, false>,
  {
    apply: (_t, _this, args: Parameters<NeonQueryFunction<false, false>>) =>
      Reflect.apply(client(), undefined, args),
    get: (_t, prop: string | symbol) => Reflect.get(client(), prop),
  },
)
