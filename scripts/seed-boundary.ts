/**
 * Loads geojson.json into the ward_boundary singleton row, unconditionally.
 *
 * This is the first-time setup path. Day to day use `npm run sync:boundary`
 * instead — it does the same thing only when the file actually changed, and then
 * re-imports parcels for the new outline.
 */
import { readBoundarySource, writeBoundary } from './lib/boundary'
import { withClient } from './lib/pg'
import { run } from './lib/run'

run(async () => {
  const source = await readBoundarySource()

  await withClient(async (client) => {
    const b = await writeBoundary(client, source, 'seed-boundary.ts')
    console.log(
      `Boundary seeded — ${b.vertices} vertices, ${Number(b.area_sqkm).toFixed(2)} km², SRID ${b.srid}, valid.`,
    )
    console.log('Run `npm run import:parcels` to pull the parcels inside it.')
  })
})
