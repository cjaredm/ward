/**
 * The one read the building map needs, in one round trip.
 *
 * Called from two places on purpose: the page's server component, so the first
 * paint has rooms in it instead of a spinner, and /api/building, so the client
 * can re-read after a write. One query, two callers — the same arrangement the
 * org chart uses.
 *
 * Everything ships together because a ward's building is small: 35 rooms of a
 * few hundred coordinates each is tens of kilobytes, well inside one request's
 * latency budget, and splitting it into per-slot fetches would mean a spinner
 * every time somebody switched hours.
 */
import { sql } from './db'
import { conflicts, pickClassOptions } from './building'
import type {
  BuildingData,
  BuildingRoom,
  ClassOptionRow,
  MeetingSlot,
  RoomAssignment,
  RoomSlotAvailability,
} from './types'
import type { Pt } from './floorplan-geom'

type RoomRow = {
  key: string
  name: string
  points: Pt[]
  label_x: number | null
  label_y: number | null
  is_assignable: boolean
  sort: number
}

export async function readBuilding(): Promise<BuildingData> {
  const [roomResult, slotResult, assignmentResult, availabilityResult, optionResult] =
    await Promise.all([
      sql`
        SELECT key, name, points, label_x, label_y, is_assignable, sort
        FROM building_rooms
        ORDER BY sort, key
      `,
      sql`
        SELECT id::text, label, starts_at::text, ends_at::text, sort, is_active
        FROM meeting_slots
        ORDER BY sort, starts_at
      `,
      sql`
        SELECT id::text, room_key, slot_id::text, title, org_key, unit, notes, sort
        FROM room_assignments
        ORDER BY sort, title
      `,
      /**
       * Only the hours somebody has deliberately opened or closed a room for.
       * Everything else follows the room's own switch — see migration 0015.
       */
      sql`
        SELECT room_key, slot_id::text, is_available
        FROM room_slot_availability
      `,
      /**
       * Every class the ward already has data for, as the org-link picker.
       *
       * The union is not redundant: a class LCR printed a roster for and a class
       * that only has a teacher called out in the callings report are both real,
       * and either alone would miss half of them.
       *
       * The two counts are separate on purpose. `people` is everybody attached
       * to the class either way, which is the number worth printing. `roster` is
       * the enrolment alone, and it is the test that tells Course 15 from the
       * Sunday School Presidency — see `isClassOption`.
       *
       * `unit` is coalesced because the callings import leaves it NULL where the
       * heading was the organization itself while `person_orgs` writes ''. The
       * two mean the same thing and have to group as one row, or every
       * organization arrives in the picker twice.
       */
      sql`
        SELECT org_key,
               coalesce(unit, '') AS unit,
               count(DISTINCT person_id)::int AS people,
               count(DISTINCT CASE WHEN src = 'roster' THEN person_id END)::int AS roster
        FROM (
          SELECT org_key, unit, person_id, 'roster' AS src FROM person_orgs
          UNION ALL
          SELECT org_key, unit, person_id, 'calling'
          FROM callings
          WHERE person_id IS NOT NULL AND released_at IS NULL
        ) t
        GROUP BY org_key, coalesce(unit, '')
      `,
    ])

  // The five queries are independent, so they go out together; the casts are
  // the house idiom for the Neon driver, which types every row as Record<string, any>.
  const roomRows = roomResult as RoomRow[]
  const slots = slotResult as MeetingSlot[]
  const assignments = assignmentResult as RoomAssignment[]
  const availability = availabilityResult as RoomSlotAvailability[]
  // Filtered and alphabetised before it leaves the server: the picker offers
  // classes and organizations, not the presidencies and committees that share
  // the same (org_key, unit) shape.
  const classOptions = pickClassOptions(optionResult as ClassOptionRow[])

  const rooms: BuildingRoom[] = roomRows.map((r) => ({
    key: r.key,
    name: r.name,
    points: r.points,
    // Both or neither: half a hand-placed anchor is not an anchor.
    label: r.label_x !== null && r.label_y !== null ? [r.label_x, r.label_y] : null,
    is_assignable: r.is_assignable,
    sort: r.sort,
  }))

  return { rooms, slots, assignments, availability, classOptions }
}

/**
 * The double-booking warnings for one block, in room names rather than keys.
 *
 * Read back after a write instead of computed from what was written, so the
 * warning accounts for rows another person added in the meantime. Lives here
 * rather than in a route file because two routes need it and a Next route module
 * may only export handlers.
 */
export async function warningsFor(slot_id: string): Promise<string[]> {
  const rows = (await sql`
    SELECT a.id::text, a.room_key, a.slot_id::text, a.title, a.org_key, a.unit, a.notes, a.sort
    FROM room_assignments a WHERE a.slot_id = ${slot_id}::uuid
  `) as RoomAssignment[]

  const names = new Map(
    ((await sql`SELECT key, name FROM building_rooms`) as { key: string; name: string }[]).map(
      (r) => [r.key, r.name],
    ),
  )

  return conflicts(rows).map(
    (c) =>
      `${c.title} is in ${c.room_keys.length} rooms this hour: ${c.room_keys
        .map((k) => names.get(k) ?? k)
        .join(', ')}.`,
  )
}

/**
 * Can a class be scheduled into this room during this hour, and what is the room
 * called if not.
 *
 * The routes used to read `building_rooms.is_assignable` on its own, which is
 * now only half the answer: a room that holds classes can still be closed for
 * one hour (migration 0015). One statement rather than two so the two facts
 * cannot be read either side of somebody else's write, and the resolution itself
 * is `roomAvailability` in src/lib/building.ts — shared with the map so the
 * server never refuses something the UI painted as free.
 */
export async function roomAvailableAt(
  room_key: string,
  slot_id: string,
): Promise<{ exists: boolean; name: string; available: boolean }> {
  const rows = (await sql`
    SELECT r.name, r.is_assignable, a.is_available
    FROM building_rooms r
    LEFT JOIN room_slot_availability a
      ON a.room_key = r.key AND a.slot_id = ${slot_id}::uuid
    WHERE r.key = ${room_key}
  `) as { name: string; is_assignable: boolean; is_available: boolean | null }[]

  if (rows.length === 0) return { exists: false, name: room_key, available: false }
  const row = rows[0]
  return {
    exists: true,
    name: row.name,
    available: row.is_available ?? row.is_assignable,
  }
}
