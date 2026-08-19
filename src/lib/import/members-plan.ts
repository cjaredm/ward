/**
 * Turns a parsed member list into a plan against the households already on the
 * map, and applies it.
 *
 * The import only ever *adds*: new households, and people missing from
 * households that already exist. It never edits an address, moves a household or
 * deletes anybody. Two reasons — the map holds hand-placed pins and hand-typed
 * notes that a report cannot know about, and a member's address changing is a
 * decision about which house on the map they now live in, which a person should
 * make with the map open.
 *
 * So a member whose address no longer matches the household they are in is
 * listed as a mover in the preview and left alone, and a person in the database
 * who is not on the report at all is listed as absent and left alone.
 */
import { coreKey, parseAddress } from '../address'
import { sql } from '../db'
import type { MemberParseResult, MemberRow } from './members'
import { PersonIndex, normalize, type DbPerson } from './match'
import { indexParcels, parkingSpot, place, type ParcelRow } from './place'

export type NewHouseholdPlan = {
  id: string
  family: string
  /** The address as the report printed it, kept on pinned households. */
  address: string | null
  parcelId: string | null
  lng: number | null
  lat: number | null
  /** Why it landed there — 'exact', 'placed between 1445 / 1466', 'parked at ward centre'. */
  placement: string
  people: { id: string; name: string }[]
}

export type AddPersonPlan = {
  id: string
  householdId: string
  household: string
  name: string
}

export type MoverPlan = { name: string; household: string; from: string | null; to: string }
export type AbsentPlan = { name: string; household: string }

export type MembersPlan = {
  unitName: string | null
  reportDate: string | null
  /** The 'Count: 558' LCR prints, to check the whole report was read. */
  printedCount: number | null
  newHouseholds: NewHouseholdPlan[]
  addPeople: AddPersonPlan[]
  movers: MoverPlan[]
  absent: AbsentPlan[]
  skipped: MemberParseResult['skipped']
  counts: {
    members: number
    known: number
    newPeople: number
    newHouseholds: number
    movers: number
    absent: number
    parked: number
  }
}

type HouseholdRow = {
  id: string
  parcel_id: string | null
  family_name: string
  /** Hand-typed address on a pinned household. */
  address: string | null
  /** The county's address, when the household sits on a parcel. */
  parcel_address: string | null
}

/** Surnames compared without spaces or case: 'Mc Elyea' is 'McElyea'. */
function surnameKey(value: string): string {
  return normalize(value).replace(/ /g, '')
}

/** House number plus street core, or null when there is no usable address. */
function addressKey(raw: string | null): string | null {
  if (!raw) return null
  const parsed = parseAddress(raw)
  return parsed ? coreKey(parsed) : null
}

/** 'Van Ausdal, Jolene' as the household records write it: 'Jolene Van Ausdal'. */
function fullName(row: MemberRow): string {
  return `${row.first} ${row.last}`.replace(/\s+/g, ' ').trim()
}

/** Street plus city line, which is what a pinned household stores. */
function printedAddress(row: MemberRow): string | null {
  return row.street ?? null
}

export async function buildMembersPlan(parsed: MemberParseResult): Promise<MembersPlan> {
  const [people, households, parcels, centreRows] = await Promise.all([
    sql`
      SELECT p.id, p.full_name, p.household_id, h.family_name
      FROM people p JOIN households h ON h.id = p.household_id
      WHERE h.deleted_at IS NULL
    ` as Promise<unknown> as Promise<DbPerson[]>,
    sql`
      SELECT h.id, h.parcel_id, h.family_name, h.address, pa.address AS parcel_address
      FROM households h
      LEFT JOIN parcels pa ON pa.parcel_id = h.parcel_id
      WHERE h.deleted_at IS NULL
    ` as Promise<unknown> as Promise<HouseholdRow[]>,
    sql`
      SELECT parcel_id, address, use_type::text AS use_type,
             ST_X(centroid) AS lng, ST_Y(centroid) AS lat
      FROM parcels
    ` as Promise<unknown> as Promise<ParcelRow[]>,
    sql`
      SELECT ST_X(ST_Centroid(geom)) AS lng, ST_Y(ST_Centroid(geom)) AS lat
      FROM ward_boundary WHERE id = 1
    ` as Promise<unknown> as Promise<{ lng: number; lat: number }[]>,
  ])

  if (centreRows.length === 0) {
    throw new Error('The ward boundary is empty, so there is nowhere to park a pin.')
  }
  const centre: [number, number] = [centreRows[0].lng, centreRows[0].lat]

  const index = new PersonIndex(people)
  const parcelIndex = indexParcels(parcels)

  const householdById = new Map(households.map((h) => [h.id, h]))
  const householdAddress = (h: HouseholdRow) => h.parcel_address ?? h.address
  const householdLabel = (h: HouseholdRow) =>
    `${h.family_name}${householdAddress(h) ? ` · ${householdAddress(h)}` : ''}`

  // Existing households by surname and address, for a family whose people are
  // all new to us but whose home is already on the map.
  const householdsByKey = new Map<string, HouseholdRow>()
  for (const h of households) {
    const key = `${surnameKey(h.family_name)}|${addressKey(householdAddress(h)) ?? ''}`
    if (!householdsByKey.has(key)) householdsByKey.set(key, h)
  }

  /**
   * One household per (address, surname). Four families share 1579 S Scenic
   * Sunrise Dr, so address alone would merge them; a surname alone would merge
   * two unrelated Smiths.
   */
  const groups = new Map<string, { family: string; address: string | null; rows: MemberRow[] }>()
  for (const row of parsed.rows) {
    const key = `${surnameKey(row.last)}|${addressKey(printedAddress(row)) ?? 'no-address'}`
    const group = groups.get(key)
    if (group) group.rows.push(row)
    else groups.set(key, { family: row.last, address: printedAddress(row), rows: [row] })
  }

  // Existing pins occupy parking spots, so a fresh batch does not stack on top of
  // the cluster already sitting at the centre of the ward.
  let parked = households.filter((h) => !h.parcel_id).length

  const newHouseholds: NewHouseholdPlan[] = []
  const addPeople: AddPersonPlan[] = []
  const movers: MoverPlan[] = []
  const matchedPeople = new Set<string>()
  let known = 0

  for (const group of groups.values()) {
    // Who in this group the ward already knows, and where they live now.
    const seats = new Map<string, number>()
    const strangers: MemberRow[] = []

    for (const row of group.rows) {
      const match = index.find({ last: row.last, first: row.first })
      if (match.status === 'matched') {
        known++
        matchedPeople.add(match.person.id)
        seats.set(match.person.household_id, (seats.get(match.person.household_id) ?? 0) + 1)
      } else if (match.status === 'ambiguous') {
        // Two people already answer to this name. Adding a third is the one
        // thing that certainly makes it worse.
        known++
        for (const c of match.candidates) matchedPeople.add(c.id)
      } else {
        strangers.push(row)
      }
    }

    // The household this family already occupies: where most of its known people
    // are, or a household with the same surname at the same address.
    const seated = [...seats.entries()].sort((a, b) => b[1] - a[1])[0]
    const target =
      (seated && householdById.get(seated[0])) ??
      householdsByKey.get(`${surnameKey(group.family)}|${addressKey(group.address) ?? ''}`) ??
      null

    if (target) {
      const current = addressKey(householdAddress(target))
      const reported = addressKey(group.address)
      if (reported && current && reported !== current) {
        for (const row of group.rows) {
          movers.push({
            name: fullName(row),
            household: householdLabel(target),
            from: householdAddress(target),
            to: group.address ?? '(no address)',
          })
        }
      }

      for (const row of strangers) {
        addPeople.push({
          id: crypto.randomUUID(),
          householdId: target.id,
          household: householdLabel(target),
          name: fullName(row),
        })
      }
      continue
    }

    if (strangers.length === 0) continue

    const placement = place(group.address, parcelIndex, () => parkingSpot(centre, parked++))
    newHouseholds.push({
      id: crypto.randomUUID(),
      family: group.family,
      // Only a pinned household needs its own address; a parcel-backed one reads
      // the county's, which the monthly import keeps current.
      address: placement.kind === 'pin' ? group.address : null,
      parcelId: placement.kind === 'parcel' ? placement.parcelId : null,
      lng: placement.kind === 'pin' ? placement.lng : null,
      lat: placement.kind === 'pin' ? placement.lat : null,
      placement: placement.kind === 'parcel' ? placement.how : placement.why,
      people: strangers.map((row) => ({ id: crypto.randomUUID(), name: fullName(row) })),
    })
  }

  const absent: AbsentPlan[] = people
    .filter((p) => !matchedPeople.has(p.id))
    .map((p) => ({
      name: p.full_name,
      household: householdById.get(p.household_id)
        ? householdLabel(householdById.get(p.household_id)!)
        : p.family_name,
    }))

  const newPeople = addPeople.length + newHouseholds.reduce((sum, h) => sum + h.people.length, 0)

  return {
    unitName: parsed.unitName,
    reportDate: parsed.reportDate,
    printedCount: parsed.printedCount,
    newHouseholds,
    addPeople,
    movers,
    absent,
    skipped: parsed.skipped,
    counts: {
      members: parsed.rows.length,
      known,
      newPeople,
      newHouseholds: newHouseholds.length,
      movers: movers.length,
      absent: absent.length,
      parked: newHouseholds.filter((h) => h.placement.includes('parked')).length,
    },
  }
}

/**
 * Writes a plan: new households, new people, and nothing else.
 *
 * Ids are generated here rather than by the database so the whole thing is one
 * transaction of set-based statements — a household and its people go in
 * together, without a round trip per row to learn what id it got.
 */
export async function applyMembersPlan(
  plan: MembersPlan,
  actor: string,
  fileName: string | null,
): Promise<{ linkedCallings: number }> {
  // How many callings are waiting on a person, so the answer below is "newly
  // linked" rather than "linked at some point".
  const unlinkedBefore = (await sql`
    SELECT count(*)::int AS n FROM callings
    WHERE released_at IS NULL AND person_id IS NULL AND printed_name IS NOT NULL
  `) as { n: number }[]

  const statements = []

  if (plan.newHouseholds.length > 0) {
    const h = plan.newHouseholds
    statements.push(sql`
      INSERT INTO households (id, parcel_id, location, family_name, status, address, updated_by)
      SELECT t.id, t.parcel_id,
             CASE WHEN t.lng IS NOT NULL
                  THEN ST_SetSRID(ST_MakePoint(t.lng, t.lat), 4326) END,
             t.family_name, 'unknown'::household_status, t.address, ${actor}
      FROM unnest(
        ${h.map((x) => x.id)}::uuid[],
        ${h.map((x) => x.parcelId)}::text[],
        ${h.map((x) => x.lng)}::double precision[],
        ${h.map((x) => x.lat)}::double precision[],
        ${h.map((x) => x.family)}::text[],
        ${h.map((x) => x.address)}::text[]
      ) AS t(id, parcel_id, lng, lat, family_name, address)
    `)
  }

  // People for the new households and the existing ones, in one statement.
  const rows = [
    ...plan.newHouseholds.flatMap((h) =>
      h.people.map((p, i) => ({ id: p.id, householdId: h.id, name: p.name, sort: i })),
    ),
    ...plan.addPeople.map((p) => ({
      id: p.id,
      householdId: p.householdId,
      name: p.name,
      sort: 99,
    })),
  ]
  if (rows.length > 0) {
    statements.push(sql`
      INSERT INTO people (id, household_id, full_name, sort_order)
      SELECT t.id, t.household_id, t.full_name, t.sort_order
      FROM unnest(
        ${rows.map((r) => r.id)}::uuid[],
        ${rows.map((r) => r.householdId)}::uuid[],
        ${rows.map((r) => r.name)}::text[],
        ${rows.map((r) => r.sort)}::int[]
      ) AS t(id, household_id, full_name, sort_order)
    `)
  }

  // The callings import stores a holder it could not match as a printed name.
  // Now that these people exist, those rows can point at them — which is most of
  // the reason the two importers are worth running together.
  //
  // Only where exactly one person answers to the name: attaching the bishop's
  // calling to the wrong Jason Cash is worse than leaving it unlinked.
  statements.push(sql`
    UPDATE callings c
    SET person_id = m.id, printed_name = NULL, updated_at = now(), updated_by = ${actor}
    FROM (
      SELECT lower(regexp_replace(full_name, '[^A-Za-z]', '', 'g')) AS norm,
             -- Postgres has no min() for uuid; there is exactly one row per
             -- name that survives the n = 1 test anyway.
             (array_agg(id ORDER BY id))[1] AS id, count(*) AS n
      FROM people
      GROUP BY 1
    ) m
    WHERE c.person_id IS NULL
      AND c.printed_name IS NOT NULL
      AND c.released_at IS NULL
      AND m.n = 1
      AND lower(regexp_replace(c.printed_name, '[^A-Za-z]', '', 'g')) = m.norm
  `)

  statements.push(sql`
    INSERT INTO import_batches (kind, file_name, stats, actor)
    VALUES ('members', ${fileName}, ${JSON.stringify(plan.counts)}, ${actor})
  `)
  // Counts and ids only — never the names or addresses themselves.
  statements.push(sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'import_members', NULL, ${JSON.stringify({
      counts: plan.counts,
      file: fileName,
    })})
  `)

  await sql.transaction(statements)

  const unlinkedAfter = (await sql`
    SELECT count(*)::int AS n FROM callings
    WHERE released_at IS NULL AND person_id IS NULL AND printed_name IS NOT NULL
  `) as { n: number }[]

  return { linkedCallings: (unlinkedBefore[0]?.n ?? 0) - (unlinkedAfter[0]?.n ?? 0) }
}
