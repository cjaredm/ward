/**
 * Turns a parsed roster report into a plan against what is already recorded, and
 * applies it.
 *
 * Nothing is written until an admin has seen the plan. This report is the whole
 * ward's membership in one file — ~1,300 roster rows across twenty-odd classes —
 * and applying it unseen would be indistinguishable from applying the wrong file.
 *
 * The report is treated as authoritative for the rosters it contains: a
 * membership recorded from a previous roster import that this report does not
 * list is removed. That is how a class actually changes — children age out of
 * Valiant 9 and are not on it next year — and every removal is listed in the
 * preview before it happens.
 *
 * Only rows this importer wrote are ever removed. The memberships the callings
 * import derives from who serves where are a different fact by a different
 * writer, and `source` is in the primary key so the two never fight over a row.
 */
import { sql } from '../db'
import { membershipTargets, orgLabel, type OrgKey } from '../orgs'
import { PersonIndex, type DbPerson } from './match'
import type { RosterParseResult, RosterRow } from './rosters'

/** How this importer's rows are marked in `person_orgs.source`. */
export const ROSTER_SOURCE = 'roster_import'

export type RosterPlanItem = {
  org: OrgKey
  unit: string
  /** Roster heading as printed: 'Gatherers of Light', 'Course 15'. */
  roster: string
  /** Name column as the report printed it. */
  printed: string
  outOfDefaultClass: boolean
  notCounted: boolean
  action:
    | 'add' /** matched a person who is not recorded in this roster yet */
    | 'keep' /** matched a person already recorded in it */
    | 'ambiguous' /** several people answer to this name */
    | 'conflict' /** another name on this report matched the same person */
    | 'unmatched' /** nobody in the ward data does */
  personId: string | null
  personName: string | null
  /** Which matching rule fired, so a loose match can be eyeballed. */
  how: string | null
  candidates: { id: string; name: string }[]
}

export type RosterPlanRemoval = {
  personId: string
  personName: string
  org: OrgKey
  unit: string
}

export type RostersPlan = {
  unitName: string | null
  reportDate: string | null
  /** Every roster the report printed, with what was read out of it. */
  rosters: {
    org: OrgKey
    unit: string
    label: string
    /** 'Primary › Valiant 9'. */
    path: string
    printedCount: number | null
    rows: number
    matched: number
  }[]
  items: RosterPlanItem[]
  removals: RosterPlanRemoval[]
  skipped: RosterParseResult['skipped']
  counts: {
    rows: number
    add: number
    keep: number
    ambiguous: number
    conflict: number
    unmatched: number
    remove: number
    rosters: number
    /** Memberships to write, roll-ups included — always more than `add` rows. */
    memberships: number
  }
}

/** Identity of a roster membership. */
function key(personId: string, org: string, unit: string): string {
  return `${personId}|${org}|${unit}`
}

/** The part of a plan item that comes straight off the report row. */
function item(row: RosterRow) {
  return {
    org: row.org,
    unit: row.unit,
    roster: row.roster,
    printed: row.printed,
    outOfDefaultClass: row.outOfDefaultClass,
    notCounted: row.notCounted,
  }
}

type Membership = { personId: string; org: OrgKey; unit: string }

export async function buildRostersPlan(parsed: RosterParseResult): Promise<RostersPlan> {
  const people = (await sql`
    SELECT p.id, p.full_name, p.household_id, h.family_name
    FROM people p
    JOIN households h ON h.id = p.household_id
    WHERE h.deleted_at IS NULL
  `) as DbPerson[]

  const existing = (await sql`
    SELECT po.person_id, po.org_key, po.unit, p.full_name
    FROM person_orgs po
    JOIN people p ON p.id = po.person_id
    WHERE po.source = ${ROSTER_SOURCE}
  `) as { person_id: string; org_key: string; unit: string; full_name: string }[]

  const index = new PersonIndex(people)
  const live = new Set(existing.map((m) => key(m.person_id, m.org_key, m.unit)))

  const items: RosterPlanItem[] = []
  /** Everything the report asserts, roll-ups included, deduped. */
  const asserted = new Map<string, Membership>()
  /**
   * The (org, unit) pairs this report speaks for. Removals are confined to
   * these, so uploading a report that somehow covered only Primary cannot empty
   * out Relief Society.
   */
  const scope = new Set<string>()
  const matchedPerRoster = new Map<string, number>()

  const rows = parsed.rows as RosterRow[]
  /** One per row, in report order. The collision check below gets a veto on these. */
  const matches = rows.map((row) => index.find({ last: row.last, first: row.first }))

  /**
   * Names that landed on somebody another name already has.
   *
   * The report prints a person the same way everywhere, so two *different*
   * printed names on one person mean at most one of them is right. In this ward
   * that is nearly always a child named after a parent — 'Richards, Colter' in
   * the Elders Quorum and 'Richards, Colter Tymber' in Valiant 9, with only the
   * father in the ward data — and the matcher's middle-name tolerance is exactly
   * what makes the son look like the father.
   *
   * Guessing here is the one mistake with no visible symptom: a Primary class
   * highlight would show a grown man's name and look entirely reasonable. So both
   * names are held back for a human, who can add the missing person and re-run.
   */
  const namesPerPerson = new Map<string, Set<string>>()
  matches.forEach((match, i) => {
    if (match.status !== 'matched') return
    const seen = namesPerPerson.get(match.person.id)
    if (seen) seen.add(rows[i].printed)
    else namesPerPerson.set(match.person.id, new Set([rows[i].printed]))
  })
  const contested = new Set(
    [...namesPerPerson].filter(([, names]) => names.size > 1).map(([personId]) => personId),
  )

  rows.forEach((row, i) => {
    const match = matches[i]

    if (match.status === 'unmatched') {
      items.push({ ...item(row), action: 'unmatched', personId: null, personName: null, how: null, candidates: [] })
      return
    }
    if (match.status === 'ambiguous') {
      items.push({
        ...item(row),
        action: 'ambiguous',
        personId: null,
        personName: null,
        how: null,
        candidates: match.candidates.map((c) => ({ id: c.id, name: c.full_name })),
      })
      return
    }
    if (contested.has(match.person.id)) {
      items.push({
        ...item(row),
        action: 'conflict',
        personId: null,
        personName: null,
        how: match.how,
        candidates: [{ id: match.person.id, name: match.person.full_name }],
      })
      return
    }

    for (const t of membershipTargets(row.org, row.unit)) {
      asserted.set(key(match.person.id, t.org, t.unit), {
        personId: match.person.id,
        org: t.org,
        unit: t.unit,
      })
      scope.add(`${t.org}|${t.unit}`)
    }

    matchedPerRoster.set(row.roster, (matchedPerRoster.get(row.roster) ?? 0) + 1)
    items.push({
      ...item(row),
      // The roster's own membership decides this, not a roll-up: a person who is
      // already in Young Women but new to Gatherers of Light is a new row.
      action: live.has(key(match.person.id, row.org, row.unit)) ? 'keep' : 'add',
      personId: match.person.id,
      personName: match.person.full_name,
      how: match.how,
      candidates: [],
    })
  })

  const removals: RosterPlanRemoval[] = existing
    .filter((m) => scope.has(`${m.org_key}|${m.unit}`))
    .filter((m) => !asserted.has(key(m.person_id, m.org_key, m.unit)))
    .map((m) => ({
      personId: m.person_id,
      personName: m.full_name,
      org: m.org_key as OrgKey,
      unit: m.unit,
    }))

  const count = (action: RosterPlanItem['action']) =>
    items.filter((i) => i.action === action).length

  return {
    unitName: parsed.unitName,
    reportDate: parsed.reportDate,
    rosters: parsed.rosters.map((r) => ({
      ...r,
      path: r.unit ? `${orgLabel(r.org)} › ${r.unit}` : orgLabel(r.org),
      matched: matchedPerRoster.get(r.label) ?? 0,
    })),
    items,
    removals,
    skipped: parsed.skipped,
    counts: {
      rows: items.length,
      add: count('add'),
      keep: count('keep'),
      ambiguous: count('ambiguous'),
      conflict: count('conflict'),
      unmatched: count('unmatched'),
      remove: removals.length,
      rosters: parsed.rosters.length,
      memberships: asserted.size,
    },
  }
}

/**
 * Writes a plan.
 *
 * A name that could not be matched is dropped rather than kept as printed text.
 * The callings importer keeps its unmatched rows because a calling exists whether
 * or not the ward's records know its holder; a membership with nobody behind it
 * has nothing to say — there is no household to highlight and no person to list.
 * The preview reports every one of them so a real gap gets fixed at the source.
 *
 * The gutter flags are shown in the preview and not stored. '**' and '*' are
 * facts about a person in one class, and a roll-up row ('this person is in
 * Primary') has nowhere honest to put them.
 *
 * Removals run before inserts inside one transaction, so a person moving between
 * two classes in the same organization cannot lose the roll-up row both of them
 * share.
 */
export async function applyRostersPlan(
  plan: RostersPlan,
  actor: string,
  fileName: string | null,
): Promise<void> {
  const adds = new Map<string, Membership>()
  for (const item of plan.items) {
    if (!item.personId) continue
    for (const t of membershipTargets(item.org, item.unit)) {
      adds.set(key(item.personId, t.org, t.unit), {
        personId: item.personId,
        org: t.org,
        unit: t.unit,
      })
    }
  }

  const statements = []

  if (plan.removals.length > 0) {
    statements.push(sql`
      DELETE FROM person_orgs po
      USING unnest(
        ${plan.removals.map((r) => r.personId)}::uuid[],
        ${plan.removals.map((r) => r.org)}::text[],
        ${plan.removals.map((r) => r.unit)}::text[]
      ) AS t(person_id, org_key, unit)
      WHERE po.person_id = t.person_id AND po.org_key = t.org_key AND po.unit = t.unit
        AND po.source = ${ROSTER_SOURCE}
    `)
  }

  if (adds.size > 0) {
    const rows = [...adds.values()]
    statements.push(sql`
      INSERT INTO person_orgs (person_id, org_key, unit, source)
      SELECT t.person_id, t.org_key, t.unit, ${ROSTER_SOURCE}
      FROM unnest(
        ${rows.map((r) => r.personId)}::uuid[],
        ${rows.map((r) => r.org)}::text[],
        ${rows.map((r) => r.unit)}::text[]
      ) AS t(person_id, org_key, unit)
      ON CONFLICT DO NOTHING
    `)
  }

  // Counts only. The batch row must not become a second copy of who is in what.
  statements.push(sql`
    INSERT INTO import_batches (kind, file_name, stats, actor)
    VALUES ('rosters', ${fileName}, ${JSON.stringify(plan.counts)}, ${actor})
  `)
  statements.push(sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'import_rosters', NULL, ${JSON.stringify({
      rosters: plan.rosters.map((r) => r.path),
      counts: plan.counts,
      file: fileName,
    })})
  `)

  await sql.transaction(statements)
}
