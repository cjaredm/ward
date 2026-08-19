/**
 * Turns the ward's rosters into the groups the map can highlight.
 *
 * Two kinds of group come out, told apart by `kind`:
 *   'org'   an organization — Elders Quorum, Young Women, Deacons Quorum.
 *   'unit'  a class or grouping inside one — 'Valiant 9', 'Course 15',
 *           'Ministering', 'Primary Activities - Boys 9 & 10'.
 *
 * Both are assembled from three sources, and which one put a person in a group is
 * kept on the member as `via`:
 *
 *   person_orgs, roster rows    on it because LCR's members report printed them
 *                               on it. This is the organization itself: the girls
 *                               in Gatherers of Light, the children in Valiant 9.
 *   person_orgs, calling rows   on it because they hold a calling in it. Written
 *                               by the callings import, rolled up to the parent
 *                               org as well.
 *   callings                    the class or grouping a calling was printed
 *                               under, which is the only way a presidency or a
 *                               'Ministering' grouping becomes a group at all.
 *
 * Keeping them in one group rather than one each is the point. A highlight of
 * Valiant 9 should be the class *and* the two adults who teach it — that is the
 * set of doors — and `via` is what lets the list beside the map say which is
 * which without splitting the highlight in two.
 *
 * Pure, and separated from the route, so the grouping and ordering can be
 * exercised without a database: see scripts/test-map-groups.ts.
 */
import { ORGS, orgLabel } from './orgs'
import type { MapGroup, MapGroupMember } from './types'

/** A row of `person_orgs`, joined out to the person's household. */
export type OrgMemberRow = {
  org_key: string
  /** The class inside the org, or '' for the org itself. */
  unit: string
  /** 'roster_import' means the members report; anything else means a calling. */
  source: string
  person_id: string
  full_name: string
  household_id: string
  family_name: string
  parcel_id: string | null
}

/** A live calling, joined out to its holder's household. */
export type CallingMemberRow = Omit<OrgMemberRow, 'unit' | 'source'> & {
  unit: string | null
  calling: string
}

const PARENT = new Map<string, string | null>(ORGS.map((o) => [o.key, o.parent]))

/**
 * Display order for the picker: top-level orgs in the seeded order, each
 * immediately followed by its children, so 'Deacons Quorum' reads as part of
 * Young Men rather than turning up under D.
 */
const ORG_ORDER = (() => {
  const order = new Map<string, number>()
  let n = 0
  for (const o of ORGS.filter((x) => !x.parent)) {
    order.set(o.key, (n += 10))
    for (const child of ORGS.filter((c) => c.parent === o.key)) order.set(child.key, (n += 10))
  }
  return order
})()

export function buildMapGroups(
  orgRows: OrgMemberRow[],
  callingRows: CallingMemberRow[],
): MapGroup[] {
  const callingsByPerson = new Map<string, CallingMemberRow[]>()
  for (const row of callingRows) {
    const list = callingsByPerson.get(row.person_id)
    if (list) list.push(row)
    else callingsByPerson.set(row.person_id, [row])
  }

  /**
   * What a person does in an org, for the member list beside the map.
   *
   * A child org's callings count towards its parent: the import puts a deacons
   * quorum adviser in Young Men as well, and a Young Men group that listed his
   * name with nothing beside it would look like a data error rather than the
   * roll-up it is.
   */
  function callingsIn(personId: string, orgKey: string, unit: string): string[] {
    return (callingsByPerson.get(personId) ?? [])
      .filter((c) => c.org_key === orgKey || PARENT.get(c.org_key) === orgKey)
      // Inside a class, only the callings printed under that class: 'Valiant 9'
      // wants its two teachers, not every Primary calling its teachers hold.
      .filter((c) => !unit || c.unit === unit)
      .map((c) => c.calling)
  }

  const groups = new Map<string, MapGroup>()

  function add(orgKey: string, unit: string, member: MapGroupMember) {
    const key = unit ? `unit:${orgKey}|${unit}` : `org:${orgKey}`
    let group = groups.get(key)
    if (!group) {
      const parent = PARENT.get(orgKey) ?? null
      group = {
        key,
        kind: unit ? 'unit' : 'org',
        label: unit || orgLabel(orgKey),
        parentLabel: unit ? orgLabel(orgKey) : parent ? orgLabel(parent) : null,
        orgKey,
        members: [],
        rosterCount: 0,
        servesCount: 0,
      }
      groups.set(key, group)
    }

    // A person can reach the same group more than once — from the roster and from
    // a calling, or from two Primary callings — and listing them twice would
    // inflate every count on the card. The ways they reach it merge instead.
    const existing = group.members.find((m) => m.personId === member.personId)
    if (!existing) {
      group.members.push(member)
      return
    }
    if (existing.via !== member.via) existing.via = 'both'
    for (const calling of member.callings) {
      if (!existing.callings.includes(calling)) existing.callings.push(calling)
    }
  }

  for (const row of orgRows) {
    add(row.org_key, row.unit, {
      personId: row.person_id,
      name: row.full_name,
      householdId: row.household_id,
      familyName: row.family_name,
      parcelId: row.parcel_id,
      callings: callingsIn(row.person_id, row.org_key, row.unit),
      via: row.source === 'roster_import' ? 'roster' : 'serves',
    })
  }

  for (const row of callingRows) {
    if (!row.unit) continue
    add(row.org_key, row.unit, {
      personId: row.person_id,
      name: row.full_name,
      householdId: row.household_id,
      familyName: row.family_name,
      parcelId: row.parcel_id,
      callings: [row.calling],
      via: 'serves',
    })
  }

  const out = [...groups.values()]
  for (const group of out) {
    group.rosterCount = group.members.filter((m) => m.via !== 'serves').length
    group.servesCount = group.members.filter((m) => m.via !== 'roster').length
  }

  return out.sort(
    (a, b) =>
      (ORG_ORDER.get(a.orgKey) ?? 999) - (ORG_ORDER.get(b.orgKey) ?? 999) ||
      // The org itself ahead of the classes inside it.
      (a.kind === b.kind ? 0 : a.kind === 'org' ? -1 : 1) ||
      a.label.localeCompare(b.label, undefined, { numeric: true }),
  )
}
