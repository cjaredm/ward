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
      `INSERT INTO households (parcel_id, family_name, status, notes, updated_by)
       VALUES ($1, $2, 'active', $3, 'clobber-test')
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
      `UPDATE parcels SET in_ward = false, use_type = 'business', business_name = $2 WHERE parcel_id = $1`,
      [parcelId, MARKER],
    )

    return { householdId, parcelId }
  })

  /**
   * Everything from here on runs inside try/finally.
   *
   * This test writes a household and flips two parcel overrides against the LIVE
   * database. An earlier version only cleaned up on the happy path, so when the
   * import threw partway it left a CLOBBER-TEST household and a parcel marked
   * `business, in_ward = false` sitting in production data. A test that
   * contaminates the thing it is checking is worse than no test.
   */
  try {
    console.log('\nRe-running import...\n')
    execFileSync('npx', ['tsx', 'scripts/import-parcels.ts'], { stdio: 'inherit' })

    await withClient(async (client) => {
      console.log('\n--- assertions ---')

      const h = await client.query<{
        family_name: string
        status: string
        notes: string | null
      }>(
        `SELECT family_name, status, notes
         FROM households WHERE id = $1 AND deleted_at IS NULL`,
        [seeded.householdId],
      )
      check('household still exists', h.rowCount, 1)
      if (h.rowCount === 1) {
        check('family_name intact', h.rows[0].family_name, MARKER)
        check('status intact', h.rows[0].status, 'active')
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
        use_type: string
        business_name: string | null
        recent: boolean
      }>(
        `SELECT in_ward, use_type, business_name, imported_at > now() - interval '10 minutes' AS recent
         FROM parcels WHERE parcel_id = $1`,
        [seeded.parcelId],
      )
      check('parcel still exists', o.rowCount, 1)
      if (o.rowCount === 1) {
        check('in_ward override preserved', o.rows[0].in_ward, false)
        check('use_type override preserved', o.rows[0].use_type, 'business')
        check('business_name override preserved', o.rows[0].business_name, MARKER)
        // Sanity: proves the import actually ran over this row rather than skipping it,
        // which would make the assertions above vacuously true.
        check('import actually touched this parcel', o.rows[0].recent, true)
      }
    })
  } finally {
    await withClient(async (client) => {
      await client.query(`DELETE FROM households WHERE id = $1`, [seeded.householdId]) // people cascade
      await client.query(
        `UPDATE parcels
         SET in_ward = true, business_name = NULL,
             use_type = CASE WHEN address IS NOT NULL AND btrim(address) <> ''
                             THEN 'residence'::parcel_use ELSE 'common_area'::parcel_use END
         WHERE parcel_id = $1`,
        [seeded.parcelId],
      )
      console.log('\nCleanup done.')
    })
  }

  if (failures > 0) {
    throw new Error(
      `${failures} assertion(s) FAILED — the import is destroying ward data. Do not run the monthly refresh.`,
    )
  }
  console.log('\nAll assertions passed — re-import preserves ward data.')
})
