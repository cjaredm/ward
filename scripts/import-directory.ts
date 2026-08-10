/**
 * Loads a ward directory export (data/directory.tsv) into `households`.
 *
 * Dry run by default — it prints exactly what it would do and touches nothing.
 * Pass --apply to write.
 *
 * Where each family lands:
 *
 *   address matches a parcel        household attached to that parcel
 *   address matches a business      pin dropped at the parcel's centroid, because
 *                                   a business parcel holds no households
 *   address matches nothing         pin, parked at the ward centre to be dragged
 *   no address in the directory     pin, parked at the ward centre to be dragged
 *
 * Several families on one address become several households on one parcel —
 * 1505 E Centaurus Way has three. That is why `households` was never unique on
 * parcel_id.
 *
 * Re-running is safe: a family is skipped when a household with the same name is
 * already on the same parcel (or already pinned with the same address). Nothing
 * here ever updates or deletes an existing row, so hand-edits made in the app
 * always win.
 *
 *   npx tsx scripts/import-directory.ts                 # dry run
 *   npx tsx scripts/import-directory.ts --apply
 *   npx tsx scripts/import-directory.ts --apply --status active --no-people
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Client } from 'pg'
import { coreKey, editDistance, fullKey, parseAddress, type Address } from './lib/address'
import { withClient } from './lib/pg'
import { run } from './lib/run'

const STATUSES = [
  'active',
  'less_active',
  'move_in',
  'moved_out',
  'not_member',
  'vacant',
  'unknown',
] as const

const ACTOR = 'import-directory.ts'

/** How far apart unplaced pins sit, in metres. Enough that labels do not collide. */
const PIN_SPACING_M = 30

type Row = { family: string; given: string; rawAddress: string; line: number }

type Group = {
  family: string
  address: Address | null
  rawAddress: string
  people: string[]
  rows: Row[]
}

type ParcelRow = {
  parcel_id: string
  address: string | null
  use_type: string
  lng: number
  lat: number
}

type Plan =
  | { kind: 'parcel'; group: Group; parcel: ParcelRow; how: string }
  | { kind: 'pin'; group: Group; lng: number; lat: number; why: string; parcel?: ParcelRow }
  | { kind: 'skip'; group: Group; why: string }

function parseArgs(argv: string[]) {
  const flag = (name: string) => argv.includes(`--${name}`)
  const value = (name: string) => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`))
    if (eq) return eq.slice(name.length + 3)
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }

  const status = value('status') ?? 'unknown'
  if (!(STATUSES as readonly string[]).includes(status)) {
    throw new Error(`--status must be one of ${STATUSES.join(', ')}`)
  }

  return {
    apply: flag('apply'),
    withPeople: !flag('no-people'),
    status,
    file: value('file') ?? join(process.cwd(), 'data', 'directory.tsv'),
  }
}

/** `Alderete, Jordan & Chelsey Denae` + `1730 S Rio Virgin Dr` per line. */
function parseTsv(text: string): Row[] {
  const rows: Row[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return
    const [name = '', address = ''] = line.split('\t')
    const comma = name.indexOf(',')
    const family = (comma === -1 ? name : name.slice(0, comma)).trim()
    const given = comma === -1 ? '' : name.slice(comma + 1).trim()
    if (!family) return
    rows.push({ family, given, rawAddress: address.trim(), line: i + 1 })
  })
  return rows
}

/**
 * One household per (address, family name). `Redd, Gayle` and `Redd, Mike` at
 * 1664 S Aspen Way are one household with two people; `Roche, Treena` at the same
 * address is a second household on the same parcel.
 *
 * Families with no address are never merged — two Hancock entries with nothing to
 * join on are two different homes.
 */
function groupRows(rows: Row[]): Group[] {
  const groups = new Map<string, Group>()

  for (const row of rows) {
    const address = row.rawAddress ? parseAddress(row.rawAddress) : null
    const key = address
      ? `${coreKey(address)}::${row.family.toUpperCase()}`
      : `noaddr:${row.line}`

    let g = groups.get(key)
    if (!g) {
      g = { family: row.family, address, rawAddress: row.rawAddress, people: [], rows: [] }
      groups.set(key, g)
    }
    g.rows.push(row)

    for (const given of row.given.split(/\s*(?:&|\band\b)\s*/i)) {
      const name = given.trim()
      if (!name) continue
      const full = `${name} ${row.family}`
      if (!g.people.includes(full)) g.people.push(full)
    }
  }

  return [...groups.values()]
}

/** Index of county parcels by both address keys. */
function indexParcels(parcels: ParcelRow[]) {
  const byFull = new Map<string, ParcelRow[]>()
  const byCore = new Map<string, ParcelRow[]>()
  const all: { parcel: ParcelRow; addr: Address }[] = []

  for (const p of parcels) {
    if (!p.address) continue
    const addr = parseAddress(p.address)
    if (!addr) continue
    all.push({ parcel: p, addr })
    for (const [map, key] of [
      [byFull, fullKey(addr)],
      [byCore, coreKey(addr)],
    ] as const) {
      const list = map.get(key)
      if (list) list.push(p)
      else map.set(key, [p])
    }
  }

  return { byFull, byCore, all }
}

/**
 * Narrows several candidates for one address down to one.
 *
 * A tie is only ever broken toward a home: a directory family living at an
 * address that also matches a shed or a common-area sliver belongs in the house.
 * Anything still ambiguous is reported rather than guessed at.
 */
function pick(candidates: ParcelRow[]): ParcelRow | null {
  if (candidates.length === 1) return candidates[0]
  const homes = candidates.filter((c) => c.use_type === 'residence')
  return homes.length === 1 ? homes[0] : null
}

function match(
  address: Address,
  idx: ReturnType<typeof indexParcels>,
): { parcel: ParcelRow; how: string } | { parcel: null; how: string } {
  const exact = pick(idx.byFull.get(fullKey(address)) ?? [])
  if (exact) return { parcel: exact, how: 'exact' }

  const core = pick(idx.byCore.get(coreKey(address)) ?? [])
  if (core) return { parcel: core, how: 'number+street' }

  // Typo tolerance, and only within the same house number: 'SUNSCREST' for
  // 'SUNCREST'. Two houses on the same number and near-identical streets do not
  // exist here, but if they ever do, `pick` refuses to choose.
  const near = idx.all.filter(
    (c) => c.addr.num === address.num && editDistance(c.addr.core, address.core, 2) <= 2,
  )
  const fuzzy = pick(near.map((c) => c.parcel))
  if (fuzzy) return { parcel: fuzzy, how: `fuzzy → ${fuzzy.address}` }

  const seen = (idx.byCore.get(coreKey(address)) ?? []).length + near.length
  return { parcel: null, how: seen > 1 ? 'ambiguous' : 'no parcel' }
}

/**
 * Guesses a point for an address the county has no parcel for, by interpolating
 * between its numbered neighbours on the same street.
 *
 * 1456 E Mesa View Ln has no parcel, but 1445 and 1466 do, and the house is
 * physically between them. A pin landing on the right block is worth far more
 * than one parked in the middle of the ward — the user still drags it the last
 * few metres, but they can see which house it belongs to.
 *
 * Returns null when the street is unknown to us, or a single neighbour makes the
 * guess meaningless.
 */
function interpolateOnStreet(
  address: Address,
  idx: ReturnType<typeof indexParcels>,
): { lng: number; lat: number; near: string } | null {
  const want = Number(address.num.replace(/\D/g, ''))
  const onStreet = idx.all
    .filter((c) => c.addr.core === address.core)
    .map((c) => ({ n: Number(c.addr.num.replace(/\D/g, '')), p: c.parcel }))
    .filter((c) => Number.isFinite(c.n))

  // Odd and even sides of a street are opposite sides of the road, so mixing
  // them puts the pin across the street from the house.
  const sameSide = onStreet.filter((c) => c.n % 2 === want % 2)
  const pool = sameSide.length >= 2 ? sameSide : onStreet
  if (pool.length < 2) return null

  const sorted = pool.sort((a, b) => Math.abs(a.n - want) - Math.abs(b.n - want)).slice(0, 2)
  const [a, b] = sorted
  if (a.n === b.n) return null

  // Clamped so an address off the end of the street lands at the end of it
  // rather than somewhere in the desert.
  const t = Math.max(0, Math.min(1, (want - a.n) / (b.n - a.n)))
  return {
    lng: a.p.lng + (b.p.lng - a.p.lng) * t,
    lat: a.p.lat + (b.p.lat - a.p.lat) * t,
    near: `${a.p.address} / ${b.p.address}`,
  }
}

/** Metres to degrees at a given latitude. */
function offset(lng: number, lat: number, dxM: number, dyM: number): [number, number] {
  const dLat = dyM / 111320
  const dLng = dxM / (111320 * Math.cos((lat * Math.PI) / 180))
  return [lng + dLng, lat + dLat]
}

/**
 * Parking spots for households we cannot place: a sunflower spiral around the
 * middle of the ward. They land in a tidy, obviously-artificial cluster the user
 * drags onto the right houses, rather than scattered over real parcels.
 */
function parkingSpot(centre: [number, number], i: number): [number, number] {
  const r = PIN_SPACING_M * Math.sqrt(i + 1)
  const theta = i * 2.399963229728653 // golden angle
  return offset(centre[0], centre[1], r * Math.cos(theta), r * Math.sin(theta))
}

async function insertHousehold(
  client: Client,
  h: {
    parcelId: string | null
    lng?: number
    lat?: number
    family: string
    status: string
    address: string | null
    people: string[]
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO households (parcel_id, location, family_name, status, address, updated_by)
     VALUES ($1,
             CASE WHEN $2::double precision IS NULL THEN NULL
                  ELSE ST_SetSRID(ST_MakePoint($2, $3), 4326) END,
             $4, $5::household_status, $6, $7)
     RETURNING id`,
    [h.parcelId, h.lng ?? null, h.lat ?? null, h.family, h.status, h.address, ACTOR],
  )
  const id = rows[0].id

  for (const [i, full_name] of h.people.entries()) {
    await client.query(
      `INSERT INTO people (household_id, full_name, sort_order) VALUES ($1, $2, $3)`,
      [id, full_name, i],
    )
  }

  // Same shape the app writes: who and where, never the names themselves.
  await client.query(
    `INSERT INTO audit_log (actor, action, entity_id, diff)
     VALUES ($1, 'create_household', $2, $3::jsonb)`,
    [
      ACTOR,
      id,
      JSON.stringify({
        anchor: h.parcelId ? 'parcel' : 'point',
        parcel_id: h.parcelId,
        source: 'directory import',
      }),
    ],
  )

  return id
}

run(async () => {
  const args = parseArgs(process.argv.slice(2))

  const text = await readFile(args.file, 'utf8').catch(() => {
    throw new Error(
      `${args.file} not found. Put the directory export there (see data/directory.tsv), or pass --file.`,
    )
  })
  const rows = parseTsv(text)
  const groups = groupRows(rows)
  console.log(`${rows.length} directory entries → ${groups.length} households\n`)

  await withClient(async (client) => {
    const parcels = (
      await client.query<ParcelRow>(
        `SELECT parcel_id, address, use_type::text AS use_type,
                ST_X(centroid) AS lng, ST_Y(centroid) AS lat
         FROM parcels`,
      )
    ).rows
    const idx = indexParcels(parcels)

    const centreRow = await client.query<{ lng: number; lat: number }>(
      `SELECT ST_X(ST_Centroid(geom)) AS lng, ST_Y(ST_Centroid(geom)) AS lat
       FROM ward_boundary WHERE id = 1`,
    )
    if (centreRow.rowCount === 0) {
      throw new Error('ward_boundary is empty — run `npm run seed:boundary` first.')
    }
    const centre: [number, number] = [centreRow.rows[0].lng, centreRow.rows[0].lat]

    // What is already there, so a re-run adds nothing twice.
    const existing = (
      await client.query<{ parcel_id: string | null; family_name: string; address: string | null }>(
        `SELECT parcel_id, family_name, address FROM households WHERE deleted_at IS NULL`,
      )
    ).rows
    const onParcel = new Set(
      existing
        .filter((h) => h.parcel_id)
        .map((h) => `${h.parcel_id}::${h.family_name.trim().toUpperCase()}`),
    )
    const pinned = new Set(
      existing
        .filter((h) => !h.parcel_id)
        .map((h) => `${h.family_name.trim().toUpperCase()}::${(h.address ?? '').toUpperCase()}`),
    )

    // Existing pins occupy parking spots too, so a second run does not stack a
    // new cluster on top of the one already sitting there.
    let parked = 0

    const plans: Plan[] = groups.map((g) => {
      const familyKey = g.family.trim().toUpperCase()

      if (!g.address) {
        if (pinned.has(`${familyKey}::`)) {
          return { kind: 'skip', group: g, why: 'already pinned' }
        }
        const [lng, lat] = parkingSpot(centre, parked++)
        return { kind: 'pin', group: g, lng, lat, why: 'no address in directory' }
      }

      const m = match(g.address, idx)

      const pinKey = `${familyKey}::${g.rawAddress.toUpperCase()}`

      if (m.parcel && m.parcel.use_type !== 'business') {
        if (onParcel.has(`${m.parcel.parcel_id}::${familyKey}`)) {
          return { kind: 'skip', group: g, why: `already on ${m.parcel.parcel_id}` }
        }
        // An earlier run pinned this family because the parcel was marked as a
        // business, and it since became a home. Attaching now would leave the
        // family on the map twice. Reported instead — moving the household is a
        // decision, and the pin may have notes on it by now.
        if (pinned.has(pinKey)) {
          return {
            kind: 'skip',
            group: g,
            why: `already pinned at this address — delete the pin to move it onto ${m.parcel.parcel_id}`,
          }
        }
        return { kind: 'parcel', group: g, parcel: m.parcel, how: m.how }
      }

      if (pinned.has(pinKey)) {
        return { kind: 'skip', group: g, why: 'already pinned' }
      }

      if (m.parcel) {
        // Known location, wrong kind of parcel: pin it exactly where it is.
        return {
          kind: 'pin',
          group: g,
          lng: m.parcel.lng,
          lat: m.parcel.lat,
          why: `${m.parcel.parcel_id} is marked business`,
          parcel: m.parcel,
        }
      }

      const guess = interpolateOnStreet(g.address, idx)
      if (guess) {
        return {
          kind: 'pin',
          group: g,
          lng: guess.lng,
          lat: guess.lat,
          why: `${m.how} — placed between ${guess.near}`,
        }
      }

      const [lng, lat] = parkingSpot(centre, parked++)
      return { kind: 'pin', group: g, lng, lat, why: `${m.how} — parked at ward centre` }
    })

    const toParcel = plans.filter((p): p is Extract<Plan, { kind: 'parcel' }> => p.kind === 'parcel')
    const toPin = plans.filter((p): p is Extract<Plan, { kind: 'pin' }> => p.kind === 'pin')
    const skipped = plans.filter((p) => p.kind === 'skip')

    console.log(`--- ${args.apply ? 'applying' : 'dry run — nothing written'} ---`)
    console.log(`attach to a parcel        ${toParcel.length}`)
    console.log(`drop a pin                ${toPin.length}`)
    console.log(`already present, skipped  ${skipped.length}\n`)

    const conflicts = skipped.filter((p) => p.kind === 'skip' && p.why.startsWith('already pinned at'))
    if (conflicts.length > 0) {
      console.log(`Pinned earlier, but the address now matches a home (${conflicts.length}):`)
      for (const p of conflicts) {
        console.log(`  ${p.group.family.padEnd(16)} ${p.group.rawAddress.padEnd(30)} ${p.kind === 'skip' ? p.why : ''}`)
      }
      console.log()
    }

    const fuzzy = toParcel.filter((p) => p.how !== 'exact')
    if (fuzzy.length > 0) {
      console.log(`Matched on something less than an exact address (${fuzzy.length}) — check these:`)
      for (const p of fuzzy) {
        console.log(
          `  ${p.group.family.padEnd(16)} ${p.group.rawAddress.padEnd(30)} → ${p.parcel.parcel_id}  ${p.parcel.address}  [${p.how}]`,
        )
      }
      console.log()
    }

    if (toPin.length > 0) {
      console.log(`Pinned rather than attached (${toPin.length}):`)
      for (const p of toPin) {
        console.log(
          `  ${p.group.family.padEnd(16)} ${(p.group.rawAddress || '(no address)').padEnd(30)} ${p.why}`,
        )
      }
      console.log()
    }

    // Parcels that end up holding more than one family.
    const perParcel = new Map<string, string[]>()
    for (const p of toParcel) {
      const list = perParcel.get(p.parcel.parcel_id) ?? []
      list.push(p.group.family)
      perParcel.set(p.parcel.parcel_id, list)
    }
    const shared = [...perParcel.entries()].filter(([, fams]) => fams.length > 1)
    if (shared.length > 0) {
      console.log(`Parcels taking more than one household (${shared.length}):`)
      for (const [pid, fams] of shared) {
        const addr = parcels.find((x) => x.parcel_id === pid)?.address ?? ''
        console.log(`  ${pid.padEnd(16)} ${addr.padEnd(30)} ${fams.join(', ')}`)
      }
      console.log()
    }

    if (!args.apply) {
      console.log('Re-run with --apply to write these.')
      return
    }

    await client.query('BEGIN')
    try {
      for (const p of plans) {
        if (p.kind === 'skip') continue
        await insertHousehold(client, {
          parcelId: p.kind === 'parcel' ? p.parcel.parcel_id : null,
          lng: p.kind === 'pin' ? p.lng : undefined,
          lat: p.kind === 'pin' ? p.lat : undefined,
          family: p.group.family,
          status: args.status,
          // Only a pin needs its own address; a parcel-backed household reads the
          // county's, which the monthly import keeps current.
          address: p.kind === 'pin' ? (p.group.rawAddress || null) : null,
          people: args.withPeople ? p.group.people : [],
        })
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }

    const people = args.withPeople
      ? plans.reduce((n, p) => n + (p.kind === 'skip' ? 0 : p.group.people.length), 0)
      : 0
    console.log(
      `Wrote ${toParcel.length + toPin.length} households and ${people} people, status '${args.status}'.`,
    )
    const atCentre = toPin.filter((p) => p.why.includes('parked at ward centre')).length
    if (atCentre > 0) {
      console.log(
        `${atCentre} pin(s) had nothing to place them by and sit clustered at the centre of the ward — open the map and drag each onto its home.`,
      )
    }
  })
})
