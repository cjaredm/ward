/**
 * The re-import must never destroy ward data.
 *
 * Seeds a household + person + manual overrides on a real parcel, re-runs the
 * import, then asserts everything survived. Run this before every monthly
 * refresh:  npm run test:clobber
 *
 * Safe to run against the live database: it cleans up the rows it created.
 */
import { execFileSync } from 'node:child_process'
import { withClient } from './lib/pg'
import { run } from './lib/run'

const MARKER = 'CLOBBER-TEST-DO-NOT-KEEP'

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  const detail = ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail}`)
  if (!ok) failures++
}

run(async () => {
  const seeded = await withClient(async (client) => {
    const parcel = await client.query<{ parcel_id: string }>(
      `SELECT parcel_id FROM parcels ORDER BY parcel_id LIMIT 1`,
    )
    if (parcel.rowCount === 0) {
      throw new Error('No parcels in the database — run `npm run import:parcels` first.')
    }
    const parcelId = parcel.rows[0].parcel_id
    console.log(`Using parcel ${parcelId}`)

    const h = await client.query<{ id: string }>(
      `INSERT INTO households (parcel_id, family_name, status, ministering_district, notes, updated_by)
       VALUES ($1, $2, 'active', 'District 7', $3, 'clobber-test')
       RETURNING id`,
      [parcelId, MARKER, MARKER],
    )
    const householdId = h.rows[0].id

    await client.query(
      `INSERT INTO people (household_id, full_name, role, phone, email)
       VALUES ($1, $2, 'head', '555-0100', 'clobber@example.test')`,
      [householdId, MARKER],
    )

    // Flip both manual overrides away from their defaults so a clobber is visible.
    await client.query(
      `UPDATE parcels SET in_ward = false, is_residential = false WHERE parcel_id = $1`,
      [parcelId],
    )

    return { householdId, parcelId }
  })

  console.log('\nRe-running import...\n')
  execFileSync('npx', ['tsx', 'scripts/import-parcels.ts'], { stdio: 'inherit' })

  await withClient(async (client) => {
    console.log('\n--- assertions ---')

    const h = await client.query<{
      family_name: string
      status: string
      ministering_district: string | null
      notes: string | null
    }>(
      `SELECT family_name, status, ministering_district, notes
       FROM households WHERE id = $1 AND deleted_at IS NULL`,
      [seeded.householdId],
    )
    check('household still exists', h.rowCount, 1)
    if (h.rowCount === 1) {
      check('family_name intact', h.rows[0].family_name, MARKER)
      check('status intact', h.rows[0].status, 'active')
      check('ministering_district intact', h.rows[0].ministering_district, 'District 7')
      check('notes intact', h.rows[0].notes, MARKER)
    }

    const p = await client.query<{ full_name: string; phone: string | null }>(
      `SELECT full_name, phone FROM people WHERE household_id = $1`,
      [seeded.householdId],
    )
    check('person still exists', p.rowCount, 1)
    if (p.rowCount === 1) check('person phone intact', p.rows[0].phone, '555-0100')

    const o = await client.query<{
      in_ward: boolean
      is_residential: boolean
      recent: boolean
    }>(
      `SELECT in_ward, is_residential, imported_at > now() - interval '10 minutes' AS recent
       FROM parcels WHERE parcel_id = $1`,
      [seeded.parcelId],
    )
    check('parcel still exists', o.rowCount, 1)
    if (o.rowCount === 1) {
      check('in_ward override preserved', o.rows[0].in_ward, false)
      check('is_residential override preserved', o.rows[0].is_residential, false)
      // Sanity: proves the import actually ran over this row rather than skipping it,
      // which would make the assertions above vacuously true.
      check('import actually touched this parcel', o.rows[0].recent, true)
    }

    // Cleanup.
    await client.query(`DELETE FROM households WHERE id = $1`, [seeded.householdId]) // people cascade
    await client.query(
      `UPDATE parcels
       SET in_ward = true, is_residential = (address IS NOT NULL AND btrim(address) <> '')
       WHERE parcel_id = $1`,
      [seeded.parcelId],
    )
    console.log('\nCleanup done.')
  })

  if (failures > 0) {
    throw new Error(
      `${failures} assertion(s) FAILED — the import is destroying ward data. Do not run the monthly refresh.`,
    )
  }
  console.log('\nAll assertions passed — re-import preserves ward data.')
})
