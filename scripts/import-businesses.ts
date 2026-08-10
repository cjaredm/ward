/**
 * Fills in business names on parcels somebody has marked as a business:
 *
 *     npm run import:businesses            # dry run — prints, writes nothing
 *     npm run import:businesses -- --apply
 *
 * Reads data/overture-places.json (see scripts/fetch-places.py) and matches each
 * POI to a parcel two ways, strongest first:
 *
 *   1. The POI coordinate falls inside the parcel polygon.
 *   2. Failing that, its address matches the county address on a business parcel.
 *      Roughly one POI in six is geocoded to the street or the wrong end of a
 *      building, so this is worth having — but it is only allowed to match
 *      parcels already marked 'business', because an address-only match is not
 *      strong enough to put a shop name on a house.
 *
 * Two rules keep a re-run from trampling ward work:
 *   - Only parcels marked 'business' get names at all. Classifying is a human
 *     judgement and a POI dataset does not get a vote.
 *   - A parcel that already has any business row is skipped entirely. That covers
 *     both hand-typed names and a tenant somebody deliberately deleted.
 *
 * Options:
 *   --apply                 write; otherwise print the plan and exit
 *   --min-confidence <0-1>  Overture's own confidence floor (default 0.3)
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Client } from 'pg'
import { coreKey, parseAddress } from './lib/address'
import { withClient } from './lib/pg'
import { run } from './lib/run'

type Place = {
  id: string
  name: string
  category: string | null
  address: string | null
  confidence: number
  lng: number
  lat: number
}

type Parcel = { parcel_id: string; address: string | null; use_type: string; tenants: number }

const PLACES_FILE = join(process.cwd(), 'data', 'overture-places.json')

function flagValue(name: string, fallback: number): number {
  const i = process.argv.indexOf(name)
  if (i === -1) return fallback
  const v = Number(process.argv[i + 1])
  return Number.isFinite(v) ? v : fallback
}

/** A place matched to a parcel, with how it got there. */
type Match = { place: Place; parcel: Parcel; how: 'polygon' | 'address' }

async function matchPlaces(client: Client, places: Place[]): Promise<Match[]> {
  const parcels = (
    await client.query<Parcel>(`
      SELECT p.parcel_id, p.address, p.use_type::text AS use_type,
             (SELECT count(*)::int FROM businesses b WHERE b.parcel_id = p.parcel_id) AS tenants
      FROM parcels p
    `)
  ).rows
  const byId = new Map(parcels.map((p) => [p.parcel_id, p]))

  // House number + street core, which is what survives 'STE 2' and 'Drive'/'Dr'.
  // Only business parcels are indexed: this is the weaker of the two matches and
  // must never reach a home.
  const byAddress = new Map<string, Parcel[]>()
  for (const p of parcels) {
    if (p.use_type !== 'business' || !p.address) continue
    const parsed = parseAddress(p.address)
    if (!parsed) continue
    const key = coreKey(parsed)
    byAddress.set(key, [...(byAddress.get(key) ?? []), p])
  }

  // One statement for all of them rather than a round trip each: PostGIS gets the
  // coordinates as an array and hands back whichever polygon contains each.
  const contained = (
    await client.query<{ id: string; parcel_id: string }>(
      `SELECT pl.id, p.parcel_id
       FROM unnest($1::text[], $2::double precision[], $3::double precision[]) AS pl(id, lng, lat)
       JOIN parcels p ON ST_Contains(p.geom, ST_SetSRID(ST_MakePoint(pl.lng, pl.lat), 4326))`,
      [places.map((p) => p.id), places.map((p) => p.lng), places.map((p) => p.lat)],
    )
  ).rows
  const inPolygon = new Map(contained.map((r) => [r.id, r.parcel_id]))

  const matches: Match[] = []
  for (const place of places) {
    const hit = inPolygon.get(place.id)
    const parcel = hit ? byId.get(hit) : undefined
    if (parcel) {
      // A POI inside a parcel nobody has called a business is left alone. Home
      // businesses are real, but naming somebody's house is the ward's call.
      if (parcel.use_type === 'business') matches.push({ place, parcel, how: 'polygon' })
      continue
    }

    const parsed = place.address ? parseAddress(place.address) : null
    const candidates = parsed ? (byAddress.get(coreKey(parsed)) ?? []) : []
    // An ambiguous address (the same number on two parcels) is skipped rather
    // than guessed at.
    if (candidates.length === 1) matches.push({ place, parcel: candidates[0], how: 'address' })
  }
  return matches
}

run(() =>
  withClient(async (client) => {
    const apply = process.argv.includes('--apply')
    const minConfidence = flagValue('--min-confidence', 0.3)

    const file = JSON.parse(readFileSync(PLACES_FILE, 'utf8')) as {
      release: string
      places: Place[]
    }
    const usable = file.places.filter((p) => p.confidence >= minConfidence)
    console.log(
      `Overture ${file.release}: ${file.places.length} places, ` +
        `${usable.length} at confidence >= ${minConfidence}`,
    )

    const matches = await matchPlaces(client, usable)

    // Group by parcel: a shared unit gets all its tenants in one go, ordered
    // best-first so the strongest name is the one the map prints.
    const byParcel = new Map<string, Match[]>()
    for (const m of matches) {
      byParcel.set(m.parcel.parcel_id, [...(byParcel.get(m.parcel.parcel_id) ?? []), m])
    }

    const skipped: string[] = []
    const planned: [Parcel, Match[]][] = []
    for (const [parcelId, group] of byParcel) {
      const parcel = group[0].parcel
      if (parcel.tenants > 0) {
        skipped.push(parcelId)
        continue
      }
      planned.push([parcel, group.sort((a, b) => b.place.confidence - a.place.confidence)])
    }
    planned.sort((a, b) => (a[0].address ?? '').localeCompare(b[0].address ?? ''))

    const names = planned.reduce((n, [, g]) => n + g.length, 0)
    console.log(
      `\n${names} name(s) for ${planned.length} parcel(s). ` +
        `${skipped.length} parcel(s) already have businesses and were left alone.\n`,
    )

    for (const [parcel, group] of planned) {
      console.log(`${parcel.address ?? parcel.parcel_id}`)
      for (const { place, how } of group) {
        console.log(
          `    ${place.name}` +
            `  [${how}, confidence ${place.confidence.toFixed(2)}` +
            `${place.category ? `, ${place.category}` : ''}]`,
        )
      }
    }

    const unmatched = usable.length - matches.length
    if (unmatched > 0) {
      console.log(
        `\n${unmatched} place(s) matched no business parcel — outside the ward, on a ` +
          `home, or on a parcel not marked as a business yet.`,
      )
    }

    if (!apply) {
      console.log('\nDry run. Nothing written. Re-run with --apply to save these.')
      return
    }

    let written = 0
    for (const [parcel, group] of planned) {
      for (const [i, { place }] of group.entries()) {
        const res = await client.query(
          `INSERT INTO businesses (parcel_id, name, category, source, source_id, sort_order, updated_by)
           VALUES ($1, $2, $3, 'overture', $4, $5, 'import:businesses')
           ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL DO NOTHING`,
          [parcel.parcel_id, place.name, place.category, place.id, i],
        )
        written += res.rowCount ?? 0
      }
      // Same stamp the app writes on a hand edit: this parcel now carries ward
      // work, so a redrawn boundary can never quietly delete it.
      await client.query(`UPDATE parcels SET ward_edited_at = now() WHERE parcel_id = $1`, [
        parcel.parcel_id,
      ])
    }

    await client.query(
      `INSERT INTO audit_log (actor, action, entity_id, diff)
       VALUES ('import:businesses', 'import_businesses', $1, $2::jsonb)`,
      [
        `${planned.length} parcels`,
        JSON.stringify({
          release: file.release,
          parcels: planned.length,
          businesses: written,
          min_confidence: minConfidence,
        }),
      ],
    )

    console.log(`\nWrote ${written} business row(s) across ${planned.length} parcel(s).`)
  }),
)
