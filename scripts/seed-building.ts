/**
 * Derives the building map from data/floorplan.html: the wall asset, and a row
 * per room.
 *
 *   npm run seed:building            apply
 *   npm run seed:building -- --dry-run   print what it would do
 *
 * Safe to re-run. Rooms insert ON CONFLICT DO NOTHING and are never updated —
 * the whole premise of this feature is "seed rough outlines, correct them in the
 * UI", and a DO UPDATE here would silently revert every correction the next time
 * anybody ran the seed.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { area } from '../src/lib/floorplan-geom'
import { FLOORPLAN } from '../src/lib/floorplan'
import { buildWallSvg, parseRooms, readSource } from './lib/floorplan-source'
import { withClient } from './lib/pg'
import { run } from './lib/run'

/** Smaller than this in floorplan units is a mistraced room, not a cupboard. */
const MIN_AREA = 25

run(async () => {
  const dryRun = process.argv.includes('--dry-run')

  const { path: sourcePath, html } = await readSource()
  const rooms = parseRooms(html)
  const svg = buildWallSvg(html, basename(sourcePath))

  const tiny = rooms.filter((r) => area(r.points) < MIN_AREA)
  if (tiny.length > 0) {
    throw new Error(
      `These rooms enclose almost no area, so the drawing is probably wrong: ${tiny
        .map((r) => r.key)
        .join(', ')}`,
    )
  }

  const target = join(process.cwd(), 'public', FLOORPLAN.src.replace(/^\//, ''))

  if (dryRun) {
    console.log(`${sourcePath}\n${rooms.length} rooms, ${Math.round(svg.length / 1024)} KB of wall linework\n`)
    for (const r of rooms) {
      const flag = r.is_assignable ? '   ' : ' — not assignable'
      console.log(
        `  ${r.key.padEnd(24)} ${r.name.padEnd(26)} ${String(r.points.length).padStart(3)} pts  ${String(
          Math.round(area(r.points)),
        ).padStart(7)} sq units${flag}`,
      )
    }
    console.log(`\nWould write ${target}`)
    console.log('Nothing was written. Drop --dry-run to apply.')
    return
  }

  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, svg, 'utf8')
  console.log(`Wrote ${target} — ${Math.round(svg.length / 1024)} KB.`)

  await withClient(async (client) => {
    let inserted = 0
    for (const r of rooms) {
      const res = await client.query(
        `INSERT INTO building_rooms (key, name, points, is_assignable, sort, updated_by)
         VALUES ($1, $2, $3::jsonb, $4, $5, 'seed-building.ts')
         ON CONFLICT (key) DO NOTHING`,
        [r.key, r.name, JSON.stringify(r.points), r.is_assignable, r.sort],
      )
      inserted += res.rowCount ?? 0
    }

    const total = (await client.query<{ n: string }>('SELECT count(*) AS n FROM building_rooms'))
      .rows[0].n
    const slots = (await client.query<{ n: string }>('SELECT count(*) AS n FROM meeting_slots'))
      .rows[0].n

    console.log(
      `Rooms: ${inserted} inserted, ${rooms.length - inserted} already present — ${total} in total.`,
    )
    if (Number(slots) === 0) {
      // Normally migration 0014 has already put the two blocks in. This covers a
      // database whose slots were cleared out by hand.
      await client.query(
        `INSERT INTO meeting_slots (label, starts_at, ends_at, sort)
         VALUES (NULL, '09:10', '09:35', 10), (NULL, '09:40', '10:05', 20)`,
      )
      console.log('Meeting slots: seeded the two 25-minute blocks.')
    } else {
      console.log(`Meeting slots: ${slots} already defined, left alone.`)
    }
  })
})
