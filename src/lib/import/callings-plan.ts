/**
 * Turns a parsed callings report into a plan against what is already in the
 * database, and applies it.
 *
 * Nothing is written until an admin has seen the plan and pressed Apply. An LCR
 * report reorganizes half the ward in one file; a preview is the difference
 * between an import and an accident.
 *
 * The report is treated as authoritative for the orgs it contains: a live
 * calling in one of those orgs that the report does not list is released. That
 * is how a reorganization actually arrives — people fall off the report — and
 * every release is listed in the preview before it happens.
 */
import { sql } from '../db'
import { org as orgDef, type OrgKey } from '../orgs'
import type { CallingRow, ParseResult } from './callings'
import { PersonIndex, type DbPerson } from './match'

export type PlanItem = {
  org: OrgKey
  calling: string
  unit: string | null
  /** Name column as the report printed it. */
  printed: string
  isCustom: boolean
  sort: number
  action:
    | 'add' /** matched a person who does not hold this calling yet */
    | 'keep' /** matched a person who already holds it */
    | 'vacancy' /** 'Calling Vacant' */
    | 'ambiguous' /** several people answer to this name */
    | 'unmatched' /** nobody in the ward data does */
  personId: string | null
  personName: string | null
  /**
   * The holder's name as the report printed it, for the rows that could not be
   * linked to a person. Written to the calling so the chart shows the calling as
   * held rather than dropping it; null on a vacancy.
   */
  printedName: string | null
  /** Which matching rule fired, so a loose match can be eyeballed. */
  how: string | null
  candidates: { id: string; name: string }[]
}

export type PlanRelease = {
  id: string
  org: OrgKey
  calling: string
  unit: string | null
  personName: string
}

export type CallingsPlan = {
  unitName: string | null
  reportDate: string | null
  /** Orgs the report covered. Releases are confined to these. */
  orgs: OrgKey[]
  items: PlanItem[]
  releases: PlanRelease[]
  skipped: ParseResult['skipped']
  counts: {
    rows: number
    add: number
    keep: number
    vacancy: number
    ambiguous: number
    unmatched: number
    release: number
    newMemberships: number
  }
}

type LiveCalling = {
  id: string
  person_id: string | null
  org_key: string
  name: string
  unit: string | null
  full_name: string | null
}

/** Identity of a held calling. Matching on this is what makes a re-run a no-op. */
function key(personId: string, org: string, name: string, unit: string | null): string {
  return [personId, org, name.trim().toLowerCase(), (unit ?? '').trim().toLowerCase()].join('|')
}

/** A person belongs to the org they serve in, and to its parent. */
function membershipOrgs(org: OrgKey): OrgKey[] {
  const parent = orgDef(org)?.parent
  return parent ? [org, parent] : [org]
}

export async function buildCallingsPlan(parsed: ParseResult): Promise<CallingsPlan> {
  const people = (await sql`
    SELECT p.id, p.full_name, p.household_id, h.family_name
    FROM people p
    JOIN households h ON h.id = p.household_id
    WHERE h.deleted_at IS NULL
  `) as DbPerson[]

  const live = (await sql`
    SELECT c.id, c.person_id, c.org_key, c.name, c.unit, p.full_name
    FROM callings c
    LEFT JOIN people p ON p.id = c.person_id
    WHERE c.released_at IS NULL
  `) as LiveCalling[]

  const index = new PersonIndex(people)
  const liveByKey = new Map<string, LiveCalling>()
  for (const c of live) {
    if (c.person_id) liveByKey.set(key(c.person_id, c.org_key, c.name, c.unit), c)
  }

  const items: PlanItem[] = []
  const reportKeys = new Set<string>()
  const orgs = new Set<OrgKey>()
  const memberships = new Set<string>()

  for (const row of parsed.rows as CallingRow[]) {
    orgs.add(row.org)
    const base = {
      org: row.org,
      calling: row.calling,
      unit: row.unit,
      printed: row.printed,
      isCustom: row.isCustom,
      sort: row.sort,
    }

    // As the household records write names: 'Haven Tyler Powell', not
    // 'Powell, Haven Tyler'.
    const printedName = row.vacant ? null : [row.first, row.last].filter(Boolean).join(' ')

    if (row.vacant) {
      items.push({
        ...base,
        action: 'vacancy',
        personId: null,
        personName: null,
        printedName: null,
        how: null,
        candidates: [],
      })
      continue
    }

    const match = index.find({ last: row.last, first: row.first })
    if (match.status === 'ambiguous') {
      items.push({
        ...base,
        action: 'ambiguous',
        personId: null,
        personName: null,
        printedName,
        how: null,
        candidates: match.candidates.map((c) => ({ id: c.id, name: c.full_name })),
      })
      continue
    }
    if (match.status === 'unmatched') {
      items.push({
        ...base,
        action: 'unmatched',
        personId: null,
        personName: null,
        printedName,
        how: null,
        candidates: [],
      })
      continue
    }

    const k = key(match.person.id, row.org, row.calling, row.unit)
    reportKeys.add(k)
    for (const o of membershipOrgs(row.org)) memberships.add(`${match.person.id}|${o}`)

    items.push({
      ...base,
      action: liveByKey.has(k) ? 'keep' : 'add',
      personId: match.person.id,
      personName: match.person.full_name,
      printedName,
      how: match.how,
      candidates: [],
    })
  }

  // Released: held, inside an org this report covered, and not on it.
  const releases: PlanRelease[] = live
    .filter((c) => c.person_id && orgs.has(c.org_key as OrgKey))
    .filter((c) => !reportKeys.has(key(c.person_id!, c.org_key, c.name, c.unit)))
    .map((c) => ({
      id: c.id,
      org: c.org_key as OrgKey,
      calling: c.name,
      unit: c.unit,
      personName: c.full_name ?? '(unknown)',
    }))

  const existingMemberships = new Set(
    (
      (await sql`SELECT person_id, org_key FROM person_orgs`) as {
        person_id: string
        org_key: string
      }[]
    ).map((m) => `${m.person_id}|${m.org_key}`),
  )
  const newMemberships = [...memberships].filter((m) => !existingMemberships.has(m))

  const count = (action: PlanItem['action']) => items.filter((i) => i.action === action).length

  return {
    unitName: parsed.unitName,
    reportDate: parsed.reportDate,
    orgs: [...orgs],
    items,
    releases,
    skipped: parsed.skipped,
    counts: {
      rows: items.length,
      add: count('add'),
      keep: count('keep'),
      vacancy: count('vacancy'),
      ambiguous: count('ambiguous'),
      unmatched: count('unmatched'),
      release: releases.length,
      newMemberships: newMemberships.length,
    },
  }
}

/**
 * Writes a plan.
 *
 * A calling whose holder could not be matched is still written, with the name as
 * printed and no person attached. Dropping it would hide a real calling from the
 * org chart — the report says somebody holds it, and the ward's own records
 * simply have not caught up.
 *
 * Everything runs in one transaction, as a handful of set-based statements
 * rather than a statement per row — the report is ~350 rows.
 */
export async function applyCallingsPlan(
  plan: CallingsPlan,
  actor: string,
  fileName: string | null,
): Promise<void> {
  const adds = plan.items.filter((i) => i.action === 'add' && i.personId)
  const keeps = plan.items.filter((i) => i.action === 'keep')
  // Everything the report shows as not-linked-to-a-person: vacancies, plus the
  // callings whose holder could not be matched. Both are stored with a null
  // person_id and told apart by printed_name.
  const unheld = plan.items.filter(
    (i) => i.action === 'vacancy' || i.action === 'ambiguous' || i.action === 'unmatched',
  )

  const memberships = new Map<string, [string, OrgKey]>()
  for (const item of plan.items) {
    if (!item.personId) continue
    for (const o of membershipOrgs(item.org)) memberships.set(`${item.personId}|${o}`, [item.personId, o])
  }

  const statements = []

  if (plan.releases.length > 0) {
    statements.push(sql`
      UPDATE callings
      SET released_at = now(), updated_at = now(), updated_by = ${actor}
      WHERE id = ANY(${plan.releases.map((r) => r.id)}::uuid[])
    `)
  }

  // Rows with no person behind them are replaced wholesale rather than
  // reconciled: an org can hold nine vacant Ward Missionary slots at once, so
  // they have no identity to match on, and an unlinked holder is only as good as
  // the last report anyway.
  if (plan.orgs.length > 0) {
    statements.push(sql`
      DELETE FROM callings
      WHERE person_id IS NULL AND released_at IS NULL AND org_key = ANY(${plan.orgs}::text[])
    `)
  }

  if (adds.length > 0) {
    statements.push(sql`
      INSERT INTO callings (person_id, org_key, name, unit, is_custom, sort, source, updated_by)
      SELECT t.person_id, t.org_key, t.name, nullif(t.unit, ''), t.is_custom, t.sort,
             'lcr_import', ${actor}
      FROM unnest(
        ${adds.map((a) => a.personId!)}::uuid[],
        ${adds.map((a) => a.org)}::text[],
        ${adds.map((a) => a.calling)}::text[],
        ${adds.map((a) => a.unit ?? '')}::text[],
        ${adds.map((a) => a.isCustom)}::boolean[],
        ${adds.map((a) => a.sort)}::int[]
      ) AS t(person_id, org_key, name, unit, is_custom, sort)
      ON CONFLICT DO NOTHING
    `)
  }

  if (unheld.length > 0) {
    statements.push(sql`
      INSERT INTO callings (person_id, printed_name, org_key, name, unit, is_custom, sort, source, updated_by)
      SELECT NULL, nullif(t.printed_name, ''), t.org_key, t.name, nullif(t.unit, ''),
             t.is_custom, t.sort, 'lcr_import', ${actor}
      FROM unnest(
        ${unheld.map((v) => v.printedName ?? '')}::text[],
        ${unheld.map((v) => v.org)}::text[],
        ${unheld.map((v) => v.calling)}::text[],
        ${unheld.map((v) => v.unit ?? '')}::text[],
        ${unheld.map((v) => v.isCustom)}::boolean[],
        ${unheld.map((v) => v.sort)}::int[]
      ) AS t(printed_name, org_key, name, unit, is_custom, sort)
    `)
  }

  // Report order for callings somebody already held: the presidency they were
  // listed under may have been reordered even when nobody moved.
  if (keeps.length > 0) {
    statements.push(sql`
      UPDATE callings c
      SET sort = t.sort, updated_at = now(), updated_by = ${actor}
      FROM unnest(
        ${keeps.map((k) => k.personId!)}::uuid[],
        ${keeps.map((k) => k.org)}::text[],
        ${keeps.map((k) => k.calling)}::text[],
        ${keeps.map((k) => k.unit ?? '')}::text[],
        ${keeps.map((k) => k.sort)}::int[]
      ) AS t(person_id, org_key, name, unit, sort)
      WHERE c.person_id = t.person_id AND c.org_key = t.org_key AND c.name = t.name
        AND coalesce(c.unit, '') = t.unit AND c.released_at IS NULL
    `)
  }

  if (memberships.size > 0) {
    const rows = [...memberships.values()]
    statements.push(sql`
      INSERT INTO person_orgs (person_id, org_key, source)
      SELECT t.person_id, t.org_key, 'import'
      FROM unnest(${rows.map((r) => r[0])}::uuid[], ${rows.map((r) => r[1])}::text[])
        AS t(person_id, org_key)
      ON CONFLICT DO NOTHING
    `)
  }

  // Counts only. The batch row must not become a second copy of who holds what.
  statements.push(sql`
    INSERT INTO import_batches (kind, file_name, stats, actor)
    VALUES ('callings', ${fileName}, ${JSON.stringify(plan.counts)}, ${actor})
  `)
  statements.push(sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'import_callings', NULL, ${JSON.stringify({
      orgs: plan.orgs,
      counts: plan.counts,
      file: fileName,
    })})
  `)

  await sql.transaction(statements)
}
