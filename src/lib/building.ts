/**
 * The building map's own logic, kept browser-free so a test script can run it.
 *
 * Everything here is a function of the rows `/api/building` returns. Nothing
 * touches the DOM, MapLibre, or the database — the same split `map-groups.ts`
 * uses against the ward map.
 */
import { orgLabel } from './orgs'
import type {
  BuildingRoom,
  ClassOption,
  ClassOptionRow,
  MeetingSlot,
  RoomAssignment,
  RoomSlotAvailability,
} from './types'

/** '09:10:00' -> '9:10'. Postgres `time` always renders seconds; nobody reads them. */
export function formatClock(time: string): string {
  const [h, m] = time.split(':')
  const hour = Number(h)
  if (!Number.isFinite(hour)) return time
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}:${m}`
}

/** What a block is called: the override if there is one, else its times. */
export function slotLabel(slot: MeetingSlot): string {
  if (slot.label && slot.label.trim()) return slot.label.trim()
  return `${formatClock(slot.starts_at)} – ${formatClock(slot.ends_at)}`
}

/** The block's times, for the line under its label. Empty when it *is* the label. */
export function slotTimes(slot: MeetingSlot): string {
  return `${formatClock(slot.starts_at)} – ${formatClock(slot.ends_at)}`
}

/**
 * Assignments arranged the way the map reads them: slot, then room.
 *
 * One pass over the flat list rather than a filter per room per render — 35
 * rooms times a handful of slots is 100+ array scans on every repaint otherwise.
 */
export function indexAssignments(
  assignments: RoomAssignment[],
): Map<string, Map<string, RoomAssignment[]>> {
  const bySlot = new Map<string, Map<string, RoomAssignment[]>>()
  for (const a of assignments) {
    let byRoom = bySlot.get(a.slot_id)
    if (!byRoom) {
      byRoom = new Map()
      bySlot.set(a.slot_id, byRoom)
    }
    const list = byRoom.get(a.room_key)
    if (list) list.push(a)
    else byRoom.set(a.room_key, [a])
  }
  for (const byRoom of bySlot.values()) {
    for (const list of byRoom.values()) {
      list.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))
    }
  }
  return bySlot
}

/**
 * The three things a room can be during one hour, and the only vocabulary the
 * map, the list and the panel use for it.
 *
 *   closed — nothing can meet here this hour. Either the room never holds
 *            classes (a hallway) or it has been marked unavailable for this
 *            hour specifically (the chapel during sacrament meeting).
 *   free   — a class could meet here this hour, and none does.
 *   booked — a class is in it.
 */
export type RoomStatus = 'closed' | 'free' | 'booked'

/**
 * What each status looks like. One table rather than colours inlined in the
 * canvas, because the legend has to paint the same swatch the rooms are painted
 * with — a legend that drifts from the map is worse than no legend.
 *
 * `fill` is flat colour at `fillOpacity`; the drawing shows through it, so the
 * walls stay readable underneath. Green and amber rather than green and red:
 * an empty room is not an error, it is the answer somebody came looking for.
 */
export const ROOM_STATUS: Record<
  RoomStatus,
  { label: string; fill: string; fillOpacity: number; stroke: string; swatch: string }
> = {
  booked: {
    label: 'Has a class',
    fill: '#86efac',
    fillOpacity: 0.5,
    stroke: '#15803d',
    swatch: '#4ade80',
  },
  free: {
    label: 'Free this hour',
    fill: '#fde047',
    fillOpacity: 0.45,
    stroke: '#a16207',
    swatch: '#facc15',
  },
  closed: {
    label: 'Not for classes',
    fill: '#d4d4d4',
    fillOpacity: 0.55,
    stroke: '#a3a3a3',
    swatch: '#d4d4d4',
  },
}

/**
 * The per-hour availability overrides, keyed the way both callers ask: room and
 * hour together.
 *
 * Same reasoning as `indexAssignments` — one pass over the exceptions rather
 * than a scan per room per repaint.
 */
export function indexAvailability(rows: RoomSlotAvailability[]): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (const r of rows) out.set(`${r.room_key}|${r.slot_id}`, r.is_available)
  return out
}

/**
 * Can a class meet in this room during this hour?
 *
 * The override if somebody set one, the room's own switch otherwise. This is the
 * resolution migration 0015 describes, and it is the only place it happens: the
 * canvas, the panel, the list and the assignment routes all come through here so
 * they cannot disagree about whether the chapel is free.
 *
 * With no hour in view there is nothing to override, so the room's switch is the
 * whole answer.
 */
export function roomAvailability(
  room: Pick<BuildingRoom, 'key' | 'is_assignable'>,
  slotId: string | null,
  overrides: Map<string, boolean>,
): boolean {
  if (!slotId) return room.is_assignable
  return overrides.get(`${room.key}|${slotId}`) ?? room.is_assignable
}

/** True only when the override says something the room does not. */
export function hasAvailabilityOverride(
  room: Pick<BuildingRoom, 'key' | 'is_assignable'>,
  slotId: string | null,
  overrides: Map<string, boolean>,
): boolean {
  if (!slotId) return false
  const value = overrides.get(`${room.key}|${slotId}`)
  return value !== undefined && value !== room.is_assignable
}

/**
 * How to paint this room for this hour.
 *
 * A class present wins over unavailability rather than being hidden by it. The
 * API refuses to schedule into a room marked unavailable, so the combination
 * only arises when somebody closed a room that already had a class in it — and
 * in that case the class is what a person standing in the hallway needs to see,
 * not the preference that was set afterwards.
 */
export function roomStatus(
  room: Pick<BuildingRoom, 'key' | 'is_assignable'>,
  slotId: string | null,
  overrides: Map<string, boolean>,
  assignedHere: number,
): RoomStatus {
  if (assignedHere > 0) return 'booked'
  return roomAvailability(room, slotId, overrides) ? 'free' : 'closed'
}

/** One class that has been put in more than one room during the same block. */
export type Conflict = {
  slot_id: string
  title: string
  room_keys: string[]
}

/**
 * The clash worth telling somebody about.
 *
 * Not two classes in one room — that is legitimate and common: '104 / 105 / 106'
 * is one traced outline over three real rooms, and the cultural hall gets
 * divided. The mistake is the same class in two places at once, which usually
 * means an assignment was moved by adding rather than editing. Reported as a
 * warning and never enforced, because a combined class does genuinely split.
 */
export function conflicts(assignments: RoomAssignment[]): Conflict[] {
  const seen = new Map<string, { slot_id: string; title: string; rooms: Set<string> }>()
  for (const a of assignments) {
    const key = `${a.slot_id}|${a.title.trim().toLowerCase()}`
    const entry = seen.get(key)
    if (entry) entry.rooms.add(a.room_key)
    else seen.set(key, { slot_id: a.slot_id, title: a.title, rooms: new Set([a.room_key]) })
  }
  const out: Conflict[] = []
  for (const { slot_id, title, rooms } of seen.values()) {
    if (rooms.size > 1) out.push({ slot_id, title, room_keys: [...rooms].sort() })
  }
  return out
}

/**
 * 'Bishop's Office' -> 'bishops-office', then '-2' and '-3' for the next two.
 *
 * The drawing already contains three rooms by that name, which is why the suffix
 * behaviour exists rather than a uniqueness constraint on the name. The key is
 * the identity everywhere; the name is only what gets printed.
 */
export function slugifyRoomKey(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'room'
  if (!taken.has(base)) return base
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(`Cannot find a free key for '${name}'`)
}

/**
 * Which block to open on: the one happening now, else the next one today, else
 * the first.
 *
 * Deliberately not "is it Sunday" — somebody checking the schedule on a Saturday
 * evening wants the morning's first hour, and somebody standing in a hallway at
 * 9:20 wants the block they are in. Time of day is the whole signal; a tap fixes
 * the rest.
 */
export function pickDefaultSlot(slots: MeetingSlot[], now: Date): MeetingSlot | null {
  const active = slots.filter((s) => s.is_active)
  if (active.length === 0) return null
  const minutes = now.getHours() * 60 + now.getMinutes()
  const at = (time: string) => {
    const [h, m] = time.split(':').map(Number)
    return h * 60 + m
  }
  const current = active.find((s) => minutes >= at(s.starts_at) && minutes < at(s.ends_at))
  if (current) return current
  const upcoming = active
    .filter((s) => at(s.starts_at) >= minutes)
    .sort((a, b) => at(a.starts_at) - at(b.starts_at))[0]
  return upcoming ?? active[0]
}

/**
 * The key a class option is picked by, in the same shape the ward map and the
 * org chart already use for a group: 'org:relief_society', 'unit:primary|Valiant 9'.
 */
export function classOptionKey(org_key: string, unit: string): string {
  return unit ? `unit:${org_key}|${unit}` : `org:${org_key}`
}

/** Splits a `classOptionKey` back apart. Null for anything unrecognised. */
export function parseClassOptionKey(key: string): { org_key: string; unit: string } | null {
  if (key.startsWith('org:')) return { org_key: key.slice(4), unit: '' }
  if (key.startsWith('unit:')) {
    const rest = key.slice(5)
    const bar = rest.indexOf('|')
    if (bar > 0) return { org_key: rest.slice(0, bar), unit: rest.slice(bar + 1) }
  }
  return null
}

/**
 * Unit names that are a group of callings rather than a class, whatever their
 * roster says.
 *
 * The roster test in `isClassOption` catches nearly all of these on its own — a
 * presidency has people called to it and nobody enrolled in it, so it arrives
 * with a roster of zero. This list is for the ones that do have a roster and
 * still are not a class: the Primary activity groups, which LCR prints with
 * every child in them but which meet on a weeknight, not in a room on Sunday.
 *
 * The rest are belt and braces for another ward's export, where a heading this
 * ward has never printed might come through with members attached.
 */
const NOT_A_CLASS: RegExp[] = [
  /\bpresidency\b/,
  /\bleaders?\b/,
  /\bactivit(y|ies)\b/,
  /\bcommittee\b/,
  /^additional\b/,
  /\bcallings$/,
  /^unassigned\b/,
]

/**
 * The sections the class picker is divided into, in the order they are shown,
 * and the only things it offers.
 *
 * This is a whitelist, and it is the point. The (org_key, unit) pairs the ward's
 * imports produce include presidencies, committees, activity groups, whole
 * organizations that never take a classroom (Ward Missionaries, Temple and
 * Family History, the Bishopric) and whole organizations that do meet but only
 * ever as their parts — nobody schedules 'Young Men' into a room, they schedule
 * the Deacons, Teachers and Priests quorums into three of them. Naming what
 * belongs is shorter and steadier than describing everything that does not.
 *
 * Two kinds of membership, because the ward's own model uses both:
 *
 *   classesOf — the organization's units are the classes, and the organization
 *               itself is not offered. Sunday School and Primary.
 *   selves    — the organization IS the class, so its org-level entry is what
 *               gets offered and its units (all presidencies and leaders) are
 *               not. The Young Women classes and the Aaronic Priesthood quorums
 *               are orgs in their own right; so are Nursery, Relief Society and
 *               Elders Quorum.
 *
 * Relief Society and Elders Quorum are in `Adults` because they meet in a room
 * on Sunday and have no parts to break into — the reason the whole-org entries
 * were dropped elsewhere does not apply to them.
 */
const CLASS_SECTIONS: { label: string; classesOf?: string[]; selves?: string[] }[] = [
  { label: 'Sunday School', classesOf: ['sunday_school'] },
  // Nursery is an org rather than a Primary unit, and is only reachable this way.
  { label: 'Primary', classesOf: ['primary'], selves: ['nursery'] },
  { label: 'Young Women', selves: ['gatherers_of_light', 'messengers_of_hope', 'builders_of_faith'] },
  { label: 'Young Men', selves: ['priests_quorum', 'teachers_quorum', 'deacons_quorum'] },
  { label: 'Adults', selves: ['relief_society', 'elders_quorum'] },
]

/** Which section this option belongs in, as an index, or -1 if it is not offered. */
function classSectionIndex(option: Pick<ClassOption, 'org_key' | 'unit'>): number {
  return CLASS_SECTIONS.findIndex((section) =>
    option.unit
      ? section.classesOf?.includes(option.org_key)
      : section.selves?.includes(option.org_key),
  )
}

/** Which section this option belongs in, or null if the picker does not offer it. */
export function classSectionFor(option: Pick<ClassOption, 'org_key' | 'unit'>): string | null {
  const at = classSectionIndex(option)
  return at === -1 ? null : CLASS_SECTIONS[at].label
}

/**
 * Is this something a class could be scheduled into a room as?
 *
 * Two tests, and they catch different things:
 *
 * 1. It has to land in a section. That is the whitelist above, and it is what
 *    removes the organizations that never take a classroom and the whole-org
 *    entries whose parts are what actually meet.
 * 2. A unit inside one of those sections has to have somebody *in* it. A class
 *    has members; a presidency, a ministering committee and a music assignment
 *    have callings and no members, and that is the whole difference. The name
 *    filter then removes the activity groups, which have both.
 *
 * An org-level entry skips the roster test — it is in the whitelist by name, so
 * a small ward whose nursery has no roster loaded still gets to schedule it.
 */
export function isClassOption(row: ClassOptionRow): boolean {
  if (classSectionFor(row) === null) return false
  if (!row.unit) return true
  if (row.roster === 0) return false
  return !NOT_A_CLASS.some((pattern) => pattern.test(row.unit.toLowerCase()))
}

/**
 * The classes the picker offers, in the order it shows them: by section, then
 * alphabetically by the name that is printed under the heading.
 *
 * Alphabetical on the short name rather than the full path, because the heading
 * already carries the organization — sorting on 'Primary › …' would file Nursery
 * before CTR 4 on the strength of a word nobody can see. Numeric collation, so
 * Valiant 10 follows Valiant 9 rather than Valiant 1 and Course 9 does not land
 * after Course 17.
 *
 * Sorted here rather than in the panel so the API's order is the order on
 * screen, and `classSections` only has to partition it.
 */
export function pickClassOptions(rows: ClassOptionRow[]): ClassOption[] {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
  return rows
    .filter(isClassOption)
    .map(({ org_key, unit, people }) => ({ org_key, unit, people }))
    .sort(
      (a, b) =>
        classSectionIndex(a) - classSectionIndex(b) ||
        collator.compare(classOptionTitle(a), classOptionTitle(b)),
    )
}

/** One `<optgroup>` of the class picker. */
export type ClassSection = { label: string; options: ClassOption[] }

/**
 * Every class already put in a room, by hour.
 *
 * Only the ones linked to a ward class: a title somebody typed by hand is not
 * something this can match on, since 'Course 15' and 'Course 15 (combined)' are
 * the same class and different strings. Keyed by `classOptionKey`, which is what
 * the picker's options are keyed by.
 */
export function takenClassKeys(assignments: RoomAssignment[]): Map<string, Set<string>> {
  const bySlot = new Map<string, Set<string>>()
  for (const a of assignments) {
    if (!a.org_key) continue
    const set = bySlot.get(a.slot_id)
    const key = classOptionKey(a.org_key, a.unit)
    if (set) set.add(key)
    else bySlot.set(a.slot_id, new Set([key]))
  }
  return bySlot
}

/**
 * The picker's options, in sections, with the classes already scheduled this
 * hour left out.
 *
 * A class that is somewhere already is not a class you are looking for a room
 * for, and offering it is offering the double-booking the map warns about. It
 * comes out of the list for the hour it is in and stays available in every other
 * hour — Course 15 meets twice on some Sundays, in two different rooms.
 *
 * `keep` is the option the form being edited is already linked to. Without it,
 * opening Edit on an assignment would find its own class missing from its own
 * picker and show a blank.
 *
 * Empty sections are dropped: a heading over nothing reads as a bug.
 */
export function classSections(
  options: ClassOption[],
  taken?: ReadonlySet<string>,
  keep?: string | null,
): ClassSection[] {
  const out: ClassSection[] = []
  for (const { label } of CLASS_SECTIONS) {
    const inSection = options.filter((o) => {
      if (classSectionFor(o) !== label) return false
      const key = classOptionKey(o.org_key, o.unit)
      return key === keep || !taken?.has(key)
    })
    if (inSection.length > 0) out.push({ label, options: inSection })
  }
  return out
}

/** 'Primary › Valiant 9' — what the org link picker lists. */
export function classOptionLabel(option: ClassOption): string {
  const org = orgLabel(option.org_key)
  return option.unit ? `${org} › ${option.unit}` : org
}

/**
 * The title to prefill when somebody picks a class from the org link picker.
 *
 * The unit if there is one, because 'Valiant 9' is what is on the door; the
 * organization's name otherwise. Still editable afterwards — the link and the
 * label are allowed to disagree, and on a combined Sunday they will.
 */
export function classOptionTitle(option: ClassOption): string {
  return option.unit || orgLabel(option.org_key)
}
