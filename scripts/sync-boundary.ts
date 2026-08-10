/**
 * Makes the database agree with geojson.json, and does it on every build.
 *
 * Redrawing the ward used to be a two-command ritual you had to remember:
 * `seed:boundary` then `import:parcels`. Forget the second and the map keeps the
 * old parcels; forget both and the committed file is a lie. So the build runs
 * this, and the workflow for changing the boundary becomes: edit geojson.json,
 * commit, deploy.
 *
 * What makes that affordable on a build step:
 *
 *   - ward_boundary.source_sha holds the SHA-256 of the file the stored boundary
 *     came from. Unchanged file, one cheap query, done. The ArcGIS fetch and the
 *     re-import only happen on a build where the outline actually moved.
 *   - A Postgres advisory lock serializes concurrent builds. The second one to
 *     arrive finds the SHA already current and no-ops.
 *   - Nothing that holds ward data is ever deleted. A parcel that falls outside
 *     the new boundary but carries households or hand-set overrides is kept and
 *     listed; see scripts/lib/parcel-import.ts. Shrinking the ward hides nothing
 *     you typed in.
 *
 * Deliberately NOT a migration runner. Schema changes still go through
 * `npm run migrate` from a terminal, for the reasons in scripts/migrate.ts.
 *
 * BOUNDARY_SYNC controls it:
 *   auto (default)  sync on local builds and Vercel production builds
 *   force           sync even on a preview build, and even if the SHA matches
 *   warn            never fail the build; report the problem and carry on
 *   off             do nothing
 */
import type { Client } from 'pg'
import { readBoundarySource, storedSha, writeBoundary } from './lib/boundary'
import { importParcels, printSummary } from './lib/parcel-import'
import { withClient } from './lib/pg'

/** Arbitrary but fixed. Any process syncing the boundary takes this lock. */
const LOCK_KEY = 7742110001

const MODE = (process.env.BOUNDARY_SYNC ?? 'auto').toLowerCase()

function log(msg: string) {
  console.log(`[sync-boundary] ${msg}`)
}

/**
 * Preview deploys are the reason this is gated.
 *
 * Every branch build carries its own copy of geojson.json. Let previews sync and
 * a branch with an older outline silently reverts production's boundary — and
 * then re-imports parcels against it. Production builds and local runs only.
 */
function shouldRun(): { run: boolean; why: string } {
  if (MODE === 'off') return { run: false, why: 'BOUNDARY_SYNC=off' }
  if (MODE === 'force') return { run: true, why: 'BOUNDARY_SYNC=force' }

  const vercelEnv = process.env.VERCEL_ENV
  if (vercelEnv && vercelEnv !== 'production') {
    return { run: false, why: `Vercel ${vercelEnv} build — production builds only` }
  }
  if (!process.env.DATABASE_URL_UNPOOLED && !process.env.DATABASE_URL) {
    return { run: false, why: 'no DATABASE_URL in the environment' }
  }
  return { run: true, why: vercelEnv ? 'Vercel production build' : 'local build' }
}

async function sync(client: Client): Promise<void> {
  const source = await readBoundarySource()
  log(`geojson.json — ${source.vertices} vertices, sha ${source.sha.slice(0, 12)}`)

  // Blocks rather than bails: two builds racing should queue, not both decide
  // the boundary is stale and both re-import.
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])
  try {
    const current = await storedSha(client)

    if (current === undefined) {
      log('ward_boundary is empty — seeding it for the first time.')
    } else if (current === source.sha && MODE !== 'force') {
      log('boundary unchanged. Nothing to do.')
      return
    } else if (current === null) {
      log('stored boundary predates SHA tracking — rebuilding once to record it.')
    } else {
      log('geojson.json has changed — rebuilding the boundary and re-importing parcels.')
    }

    const b = await writeBoundary(client, source, 'sync-boundary.ts')
    log(
      `boundary written — ${b.vertices} vertices, ${Number(b.area_sqkm).toFixed(2)} km², valid.`,
    )

    const summary = await importParcels(client)
    printSummary(summary)

    log(
      `done — ${summary.inserted} new parcel(s), ${summary.removed} removed, ` +
        `${summary.retained.length} kept outside the boundary because they hold ward data.`,
    )
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])
  }
}

async function main() {
  const decision = shouldRun()
  if (!decision.run) {
    log(`skipped — ${decision.why}.`)
    return
  }
  log(decision.why)
  await withClient(sync)
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  if (MODE === 'warn') {
    log(`FAILED but continuing (BOUNDARY_SYNC=warn): ${message}`)
    return
  }
  // Loud by default. A deploy that quietly ships the old boundary after someone
  // edited geojson.json is worse than a deploy that stops and says so.
  console.error(`\n[sync-boundary] ${message}`)
  console.error('Set BOUNDARY_SYNC=warn to let the build continue past this.')
  if (err instanceof Error && err.stack && process.env.DEBUG) console.error(err.stack)
  process.exit(1)
})
