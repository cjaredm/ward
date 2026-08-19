/**
 * Exercises the map's group builder. No database, invented names.
 *
 *   npx tsx scripts/test-map-groups.ts
 */
import {
  buildMapGroups,
  type CallingMemberRow,
  type OrgMemberRow,
} from '../src/lib/map-groups'
import { run } from './lib/run'

/** Two households: the Barlows on a county parcel, the Reids on a pin. */
const HOMES = {
  barlow: { household_id: 'h-barlow', family_name: 'Barlow', parcel_id: 'W-SSR-4-402' },
  reid: { household_id: 'h-reid', family_name: 'Reid', parcel_id: null },
}

const PEOPLE = {
  taylor: { person_id: 'p-taylor', full_name: 'Taylor Barlow', ...HOMES.barlow },
  jolene: { person_id: 'p-jolene', full_name: 'Jolene Barlow', ...HOMES.barlow },
  kelsee: { person_id: 'p-kelsee', full_name: 'Kelsee Reid', ...HOMES.reid },
  /** A child on a Primary roster and nothing else — the case rosters exist for. */
  remi: { person_id: 'p-remi', full_name: 'Remi Barlow', ...HOMES.barlow },
}

/** What the callings import writes: who serves where, rolled up to the parent. */
const serves = (org_key: string, person: (typeof PEOPLE)[keyof typeof PEOPLE]): OrgMemberRow => ({
  org_key,
  unit: '',
  source: 'import',
  ...person,
})

/** What the roster import writes: who belongs, with the class they were printed in. */
const roster = (
  org_key: string,
  unit: string,
  person: (typeof PEOPLE)[keyof typeof PEOPLE],
): OrgMemberRow => ({ org_key, unit, source: 'roster_import', ...person })

const ORG_ROWS: OrgMemberRow[] = [
  serves('primary', PEOPLE.jolene),
  serves('primary', PEOPLE.kelsee),
  serves('elders_quorum', PEOPLE.taylor),
  // A child org and its parent, which is what the import writes for one calling.
  serves('young_men', PEOPLE.taylor),
  serves('deacons_quorum', PEOPLE.taylor),
  // The roster: a child in Valiant 9, rolled up to Primary as the importer does.
  roster('primary', 'Valiant 9', PEOPLE.remi),
  roster('primary', '', PEOPLE.remi),
  // A teacher who is also on her own organization's roster — one member row, and
  // she reaches Primary two ways.
  roster('primary', 'Valiant 9', PEOPLE.jolene),
  roster('primary', '', PEOPLE.jolene),
]

const CALLING_ROWS: CallingMemberRow[] = [
  { org_key: 'primary', unit: 'Valiant 9', calling: 'Primary Teacher', ...PEOPLE.jolene },
  // Same person, same org, a second calling: one member row listing both.
  { org_key: 'primary', unit: 'Music', calling: 'Primary Music Leader', ...PEOPLE.jolene },
  { org_key: 'primary', unit: 'Valiant 9', calling: 'Primary Teacher', ...PEOPLE.kelsee },
  { org_key: 'elders_quorum', unit: null, calling: 'Elders Quorum President', ...PEOPLE.taylor },
  {
    org_key: 'deacons_quorum',
    unit: 'Deacons Quorum Adult Leaders',
    calling: 'Deacons Quorum Adviser',
    ...PEOPLE.taylor,
  },
]

run(async () => {
  const groups = buildMapGroups(ORG_ROWS, CALLING_ROWS)
  for (const g of groups) {
    console.log(
      `${g.key}  [${g.kind}]  ${g.parentLabel ? `${g.parentLabel} > ` : ''}${g.label}  ` +
        `(${g.members.map((m) => `${m.name}${m.callings.length ? `: ${m.callings.join('/')}` : ''}`).join(' · ')})`,
    )
  }

  const failures: string[] = []
  const by = (key: string) => groups.find((g) => g.key === key)
  const check = (cond: boolean, why: string) => {
    if (!cond) failures.push(why)
  }

  const primary = by('org:primary')
  check(
    primary?.members.find((m) => m.personId === 'p-jolene')?.callings.join('/') ===
      'Primary Teacher/Primary Music Leader',
    'both of a holder’s callings in an org should be listed on her one member row',
  )
  check(
    primary?.members.find((m) => m.personId === 'p-kelsee')?.parcelId === null,
    'a pinned household should come through with a null parcel',
  )

  const valiant = by('unit:primary|Valiant 9')
  check(valiant?.kind === 'unit', 'a sub-heading should come out as a unit group')
  check(valiant?.parentLabel === 'Primary', 'a unit should name the org it was printed under')
  check(
    valiant?.members.length === 3,
    'Valiant 9 should hold the child on its roster and both its teachers',
  )

  // The whole point of the roster import: the class and the adults who teach it
  // are one highlight, and `via` is what tells them apart in the list.
  const viaOf = (key: string, personId: string) =>
    by(key)?.members.find((m) => m.personId === personId)?.via
  check(viaOf('unit:primary|Valiant 9', 'p-remi') === 'roster', 'a child reaches a class as roster')
  check(
    viaOf('unit:primary|Valiant 9', 'p-kelsee') === 'serves',
    'a teacher with no roster row reaches a class as serves',
  )
  check(
    viaOf('unit:primary|Valiant 9', 'p-jolene') === 'both',
    'somebody on the roster who also teaches the class reaches it both ways',
  )
  check(
    valiant?.rosterCount === 2 && valiant?.servesCount === 2,
    `Valiant 9 should count 2 on the roster and 2 serving, got ${valiant?.rosterCount}/${valiant?.servesCount}`,
  )
  check(
    primary?.members.length === 3,
    'the Primary org group should hold the class roll-up as well as who serves',
  )
  check(
    valiant?.members.find((m) => m.personId === 'p-remi')?.callings.length === 0,
    'a child on a roster holds no calling',
  )

  const deacons = by('org:deacons_quorum')
  check(deacons?.parentLabel === 'Young Men', 'a child org should name its parent')

  // A parent org rolls up its children's callings, so nobody is listed bare.
  check(
    by('org:young_men')?.members[0]?.callings.join('/') === 'Deacons Quorum Adviser',
    'a Young Men member should be listed with the quorum calling that put him there',
  )

  // Every group is a set of people: nobody twice, however many ways they qualify.
  for (const g of groups) {
    const ids = new Set(g.members.map((m) => m.personId))
    check(ids.size === g.members.length, `${g.key} lists somebody twice`)
  }

  // A vacancy has no holder, so it can never reach here — a group with no
  // members would be an entry in the picker that highlights nothing.
  check(
    groups.every((g) => g.members.length > 0),
    'no group may be empty',
  )

  // Picker order: an org ahead of its own classes, children under their parent.
  const keys = groups.map((g) => g.key)
  const order = (k: string) => keys.indexOf(k)
  check(
    order('org:elders_quorum') < order('org:young_men'),
    'Elders Quorum sorts ahead of Young Men, as the orgs table seeds it',
  )
  check(
    order('org:young_men') < order('org:deacons_quorum'),
    'a child org sorts under its parent, not alphabetically',
  )
  check(
    order('org:primary') < order('unit:primary|Valiant 9'),
    'an org sorts ahead of the classes inside it',
  )
  check(
    order('unit:primary|Music') < order('unit:primary|Valiant 9'),
    'classes within an org sort alphabetically',
  )

  console.log()
  if (failures.length > 0) {
    for (const f of failures) console.log(`FAIL  ${f}`)
    process.exitCode = 1
    return
  }
  console.log(`ok — ${groups.length} groups`)
})
