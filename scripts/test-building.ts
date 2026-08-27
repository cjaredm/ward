/**
 * Exercises the building map's slot, index and conflict logic. No database.
 *
 *   npx tsx scripts/test-building.ts
 */
import {
  ROOM_STATUS,
  classOptionKey,
  classOptionLabel,
  classOptionTitle,
  conflicts,
  formatClock,
  indexAssignments,
  classSectionFor,
  classSections,
  hasAvailabilityOverride,
  indexAvailability,
  isClassOption,
  parseClassOptionKey,
  pickClassOptions,
  pickDefaultSlot,
  roomAvailability,
  roomStatus,
  slotLabel,
  slugifyRoomKey,
  takenClassKeys,
} from '../src/lib/building'
import type { BuildingRoom, ClassOptionRow, MeetingSlot, RoomAssignment } from '../src/lib/types'
import { run } from './lib/run'

const slot = (over: Partial<MeetingSlot> & { id: string }): MeetingSlot => ({
  label: null,
  starts_at: '09:10:00',
  ends_at: '09:35:00',
  sort: 10,
  is_active: true,
  ...over,
})

const FIRST = slot({ id: 's1', starts_at: '09:10:00', ends_at: '09:35:00', sort: 10 })
const SECOND = slot({ id: 's2', starts_at: '09:40:00', ends_at: '10:05:00', sort: 20 })

const assign = (over: Partial<RoomAssignment> & { id: string }): RoomAssignment => ({
  room_key: '101',
  slot_id: 's1',
  title: 'Course 15',
  org_key: null,
  unit: '',
  notes: null,
  sort: 0,
  ...over,
})

const roomOf = (key: string, is_assignable = true): BuildingRoom => ({
  key,
  name: key,
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
  ],
  label: null,
  is_assignable,
  sort: 0,
})

/** 9:20am on an arbitrary day — inside the first block. */
const at = (h: number, m: number) => new Date(2026, 0, 4, h, m, 0)

run(async () => {
  const failures: string[] = []
  const check = (cond: boolean, why: string) => {
    if (!cond) failures.push(why)
  }

  // --- clock / labels -------------------------------------------------------
  check(formatClock('09:10:00') === '9:10', `'09:10:00' -> 9:10, got ${formatClock('09:10:00')}`)
  check(formatClock('13:05:00') === '1:05', `'13:05:00' -> 1:05, got ${formatClock('13:05:00')}`)
  check(formatClock('00:30:00') === '12:30', `midnight should read as 12:30, got ${formatClock('00:30:00')}`)
  check(
    slotLabel(FIRST) === '9:10 – 9:35',
    `an unlabelled slot should read as its times, got ${slotLabel(FIRST)}`,
  )
  check(
    slotLabel(slot({ id: 's3', label: 'Sunday School' })) === 'Sunday School',
    'a labelled slot should use its label',
  )
  check(
    slotLabel(slot({ id: 's4', label: '   ' })) === '9:10 – 9:35',
    'a blank label is not a label',
  )

  // --- pickDefaultSlot ------------------------------------------------------
  const slots = [FIRST, SECOND]
  check(pickDefaultSlot(slots, at(9, 20))?.id === 's1', 'mid-first-block should pick the first block')
  check(
    pickDefaultSlot(slots, at(9, 37))?.id === 's2',
    'in the gap between blocks should pick the one about to start',
  )
  check(pickDefaultSlot(slots, at(6, 0))?.id === 's1', 'before church should pick the first block')
  check(pickDefaultSlot(slots, at(22, 0))?.id === 's1', 'after church should fall back to the first block')
  check(
    pickDefaultSlot(slots, at(9, 35))?.id === 's2',
    'the boundary minute belongs to the next block, not the one that just ended',
  )
  check(
    pickDefaultSlot([FIRST, { ...SECOND, is_active: false }], at(9, 45))?.id === 's1',
    'an inactive block should never be picked',
  )
  check(pickDefaultSlot([], at(9, 20)) === null, 'no slots means no default')

  // --- indexAssignments -----------------------------------------------------
  const assignments = [
    assign({ id: 'a1', room_key: '101', slot_id: 's1', title: 'Course 15', sort: 0 }),
    assign({ id: 'a2', room_key: '101', slot_id: 's2', title: 'Elders Quorum' }),
    // Two classes in one room in one block: legal, and the reason there is no
    // unique constraint on (room, slot).
    assign({ id: 'a3', room_key: 'cultural-center-one', slot_id: 's1', title: 'Primary', sort: 1 }),
    assign({ id: 'a4', room_key: 'cultural-center-one', slot_id: 's1', title: 'Nursery', sort: 0 }),
  ]
  const index = indexAssignments(assignments)
  check(index.size === 2, `two blocks should be indexed, got ${index.size}`)
  check(
    index.get('s1')?.get('101')?.length === 1,
    'room 101 has one class in the first block',
  )
  const hall = index.get('s1')?.get('cultural-center-one') ?? []
  check(hall.length === 2, `the hall should hold two classes in one block, got ${hall.length}`)
  check(
    hall[0].title === 'Nursery',
    `classes in a room should come back in sort order, got ${hall.map((a) => a.title).join(', ')}`,
  )
  check(index.get('s2')?.get('cultural-center-one') === undefined, 'an empty room is absent, not empty')

  // --- conflicts ------------------------------------------------------------
  check(conflicts(assignments).length === 0, 'nothing above is double-booked')
  const doubled = [
    ...assignments,
    assign({ id: 'a5', room_key: '102', slot_id: 's1', title: 'course 15' }),
  ]
  const clash = conflicts(doubled)
  check(clash.length === 1, `one class in two rooms should be one conflict, got ${clash.length}`)
  check(
    clash[0]?.room_keys.join(',') === '101,102',
    `the conflict should name both rooms, got ${clash[0]?.room_keys.join(',')}`,
  )
  check(
    conflicts([
      assign({ id: 'b1', room_key: '101', slot_id: 's1', title: 'Course 15' }),
      assign({ id: 'b2', room_key: '102', slot_id: 's2', title: 'Course 15' }),
    ]).length === 0,
    'the same class in different blocks is the normal case, not a clash',
  )

  // --- slugifyRoomKey -------------------------------------------------------
  const taken = new Set<string>()
  const next = (name: string) => {
    const key = slugifyRoomKey(name, taken)
    taken.add(key)
    return key
  }
  check(next("Bishop's Office") === 'bishops-office', 'an apostrophe is dropped, not hyphenated')
  check(next("Bishop's Office") === 'bishops-office-2', 'the second room of a name takes -2')
  check(next("Bishop's Office") === 'bishops-office-3', 'and the third takes -3')
  check(next('104 / 105 / 106') === '104-105-106', 'slashes become single hyphens')
  check(next('Platform / Stage') === 'platform-stage', 'and so do the spaces around them')
  check(next('  ') === 'room', 'a nameless room still gets a usable key')

  // --- class option keys ----------------------------------------------------
  check(classOptionKey('primary', 'Valiant 9') === 'unit:primary|Valiant 9', 'a class keys as a unit')
  check(classOptionKey('relief_society', '') === 'org:relief_society', 'an org with no unit keys as an org')
  check(
    JSON.stringify(parseClassOptionKey('unit:primary|Valiant 9')) ===
      JSON.stringify({ org_key: 'primary', unit: 'Valiant 9' }),
    'a unit key parses back apart',
  )
  check(
    JSON.stringify(parseClassOptionKey('org:relief_society')) ===
      JSON.stringify({ org_key: 'relief_society', unit: '' }),
    'an org key parses back apart',
  )
  check(parseClassOptionKey('nonsense') === null, 'an unrecognised key parses to null')
  check(
    parseClassOptionKey('unit:primary|Boys 9 & 10 | Extra')?.unit === 'Boys 9 & 10 | Extra',
    'only the first bar separates the org from the unit',
  )
  check(
    classOptionLabel({ org_key: 'primary', unit: 'Valiant 9', people: 8 }) === 'Primary › Valiant 9',
    'a class reads as org then unit',
  )
  check(
    classOptionTitle({ org_key: 'primary', unit: 'Valiant 9', people: 8 }) === 'Valiant 9',
    'the unit is what goes on the door',
  )
  check(
    classOptionTitle({ org_key: 'relief_society', unit: '', people: 40 }) === 'Relief Society',
    'an org with no unit falls back to its own name',
  )

  // --- per-hour availability ------------------------------------------------
  const CHAPEL = roomOf('chapel')
  const HALL = roomOf('hallway', false)
  const overrides = indexAvailability([
    { room_key: 'chapel', slot_id: 's1', is_available: false },
    { room_key: 'hallway', slot_id: 's2', is_available: true },
  ])

  check(
    roomAvailability(CHAPEL, 's1', overrides) === false,
    'an override closes a room that otherwise holds classes',
  )
  check(
    roomAvailability(CHAPEL, 's2', overrides) === true,
    'the override applies to its own hour only',
  )
  check(
    roomAvailability(HALL, 's1', overrides) === false,
    'with no override a room follows its own switch',
  )
  check(
    roomAvailability(HALL, 's2', overrides) === true,
    'an override can open a space the room says never holds classes',
  )
  check(
    roomAvailability(CHAPEL, null, overrides) === true,
    'with no hour in view there is nothing to override',
  )
  check(
    hasAvailabilityOverride(CHAPEL, 's1', overrides) &&
      !hasAvailabilityOverride(CHAPEL, 's2', overrides),
    'an override only counts where it disagrees with the room',
  )
  check(
    !hasAvailabilityOverride(
      CHAPEL,
      's1',
      indexAvailability([{ room_key: 'chapel', slot_id: 's1', is_available: true }]),
    ),
    'a row that repeats the room is not an override',
  )

  // --- roomStatus -----------------------------------------------------------
  check(roomStatus(CHAPEL, 's2', overrides, 0) === 'free', 'available and empty is free')
  check(roomStatus(CHAPEL, 's2', overrides, 1) === 'booked', 'a class in it is booked')
  check(roomStatus(CHAPEL, 's1', overrides, 0) === 'closed', 'closed for the hour is closed')
  check(roomStatus(HALL, 's1', overrides, 0) === 'closed', 'a hallway is closed')
  check(
    roomStatus(CHAPEL, 's1', overrides, 1) === 'booked',
    'a class present outranks the room being closed — the class is what somebody needs to see',
  )
  check(
    (['booked', 'free', 'closed'] as const).every(
      (k) => ROOM_STATUS[k].label.length > 0 && ROOM_STATUS[k].swatch.startsWith('#'),
    ),
    'every status has a legend label and a swatch colour',
  )

  // --- which options are classes --------------------------------------------
  const option = (
    org_key: string,
    unit: string,
    roster: number,
    callings = 0,
  ): ClassOptionRow => ({ org_key, unit, people: roster + callings, roster })

  check(isClassOption(option('sunday_school', 'Course 15', 11, 4)), 'a class with a roster is a class')
  check(
    isClassOption(option('relief_society', '', 185)),
    'Relief Society meets in a room and has no parts to break into',
  )
  check(
    isClassOption(option('nursery', '', 0)),
    'an org-level class is whitelisted by name, so it survives an empty roster',
  )
  check(
    !isClassOption(option('sunday_school', 'Sunday School Presidency', 0, 4)),
    'a presidency has callings and no roster, so it is not a class',
  )
  check(
    !isClassOption(option('deacons_quorum', 'Deacons Quorum Adult Leaders', 0, 3)),
    'an adult leaders group is not a class',
  )
  check(
    !isClassOption(option('relief_society', 'Ministering', 0, 4)),
    'a committee is not a class',
  )
  check(
    !isClassOption(option('primary', 'Primary Activities - Boys 9 & 10', 10, 2)),
    'an activity group has a full roster and still is not a class — the name is what rules it out',
  )
  check(
    !isClassOption(option('primary', 'Unassigned Teachers', 0, 1)),
    'unassigned teachers are not a class',
  )
  check(
    !isClassOption(option('young_women', 'Bee Hive Class Leaders', 12, 2)),
    'the name filter still applies to a leaders group that came through with a roster',
  )

  // --- the whitelist -------------------------------------------------------
  for (const org of ['other', 'bishopric', 'ward_missionaries', 'temple_family_history', 'young_single_adult']) {
    check(
      !isClassOption(option(org, '', 40)),
      `${org} does not take a classroom and is not offered`,
    )
  }
  for (const org of ['young_men', 'young_women', 'primary', 'sunday_school']) {
    check(
      !isClassOption(option(org, '', 100)),
      `${org} is only ever scheduled as its parts, so the whole org is not offered`,
    )
  }
  check(
    classSectionFor({ org_key: 'nursery', unit: '' }) === 'Primary',
    'Nursery is an org of its own and belongs under the Primary heading',
  )
  check(
    classSectionFor({ org_key: 'deacons_quorum', unit: '' }) === 'Young Men' &&
      classSectionFor({ org_key: 'builders_of_faith', unit: '' }) === 'Young Women',
    'the quorums and the classes sit under their parent organization',
  )
  check(
    classSectionFor({ org_key: 'deacons_quorum', unit: 'Deacons Quorum Presidency' }) === null,
    'a unit inside a self-scheduling org has no section',
  )
  check(
    classSectionFor({ org_key: 'sunday_school', unit: '' }) === null &&
      classSectionFor({ org_key: 'sunday_school', unit: 'Course 15' }) === 'Sunday School',
    'a classesOf org offers its classes and not itself',
  )

  const picked = pickClassOptions([
    option('sunday_school', 'Course 17', 11, 4),
    option('primary', 'Valiant 10', 18, 3),
    option('primary', 'Valiant 9', 11, 4),
    option('nursery', '', 17),
    option('primary', 'CTR 4', 10, 4),
    option('sunday_school', 'Course 9', 9, 1),
    option('sunday_school', '', 458),
    option('relief_society', '', 185),
    option('primary', 'Primary Presidency', 0, 4),
    option('bishopric', '', 9),
  ]).map(classOptionTitle)

  check(
    JSON.stringify(picked) ===
      JSON.stringify([
        'Course 9',
        'Course 17',
        'CTR 4',
        'Nursery',
        'Valiant 9',
        'Valiant 10',
        'Relief Society',
      ]),
    `sections in order, alphabetical and numeric inside them — got ${picked.join(' | ')}`,
  )

  // --- classes that already have a room ------------------------------------
  const placed = takenClassKeys([
    assign({ id: 'a1', slot_id: 's1', room_key: '101', title: 'Course 15', org_key: 'sunday_school', unit: 'Course 15' }),
    assign({ id: 'a2', slot_id: 's2', room_key: '104', title: 'Valiant 9', org_key: 'primary', unit: 'Valiant 9' }),
    assign({ id: 'a3', slot_id: 's1', room_key: '106', title: 'Combined youth' }),
  ])
  check(
    placed.get('s1')?.has('unit:sunday_school|Course 15') === true,
    'a linked class counts as having a room',
  )
  check(placed.get('s1')?.size === 1, 'an assignment with no class link cannot be matched, so it is skipped')
  check(
    placed.get('s2')?.has('unit:primary|Valiant 9') === true &&
      placed.get('s1')?.has('unit:primary|Valiant 9') !== true,
    'having a room is per hour: Valiant 9 is taken second hour and free first',
  )

  const shelf = pickClassOptions([
    option('sunday_school', 'Course 15', 11, 4),
    option('sunday_school', 'Course 16', 20, 4),
    option('primary', 'Valiant 9', 11, 4),
  ])
  const offered = (keep?: string) =>
    classSections(shelf, placed.get('s1'), keep ?? null)
      .flatMap((section) => section.options)
      .map(classOptionTitle)

  check(
    JSON.stringify(offered()) === JSON.stringify(['Course 16', 'Valiant 9']),
    `a class with a room this hour drops out of the picker — got ${offered().join(', ')}`,
  )
  check(
    JSON.stringify(offered('unit:sunday_school|Course 15')) ===
      JSON.stringify(['Course 15', 'Course 16', 'Valiant 9']),
    'the row being edited keeps its own class, or its picker would open blank',
  )
  check(
    classSections(shelf, placed.get('s1')).every((section) => section.options.length > 0),
    'a heading with nothing under it is dropped',
  )
  check(
    classSections(shelf).map((s) => s.label).join('|') === 'Sunday School|Primary',
    'sections come back in the order they are declared, not alphabetically',
  )

  console.log()
  if (failures.length > 0) {
    for (const f of failures) console.log(`FAIL  ${f}`)
    process.exitCode = 1
    return
  }
  console.log('ok — building logic')
})
