/**
 * Monthly refresh of the county parcel layer:  npm run import:parcels
 *
 * The work itself lives in scripts/lib/parcel-import.ts, which scripts/sync-boundary.ts
 * also calls after the ward boundary is redrawn.
 *
 * Run `npm run test:clobber` first. It proves this does not eat hand-entered data.
 */
import { importParcels, printSummary } from './lib/parcel-import'
import { withClient } from './lib/pg'
import { run } from './lib/run'

run(() => withClient(async (client) => printSummary(await importParcels(client))))
