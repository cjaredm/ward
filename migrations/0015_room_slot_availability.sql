-- Which rooms are available for a class, hour by hour.
--
-- 0014 gave a room one switch: `building_rooms.is_assignable`, meaning "classes
-- never meet in here" — the hallways, the serving area, the platform. That is
-- the right shape for a hallway and the wrong shape for the chapel, the
-- cultural hall and the Relief Society room, which hold classes some hours and
-- are unavailable in others because sacrament meeting is in them, or the youth
-- have them, or a funeral does. Without a per-hour answer those rooms show up
-- in "rooms free this hour" during the one hour they are certainly not free.
--
-- Two decisions:
--
-- 1. This is an EXCEPTION table, not a matrix. 35 rooms times the hours on a
--    Sunday is a grid somebody has to keep filled in, and every new hour would
--    start life as ~35 rows that mean "no opinion". Absence of a row means
--    "whatever the room says", so a fresh hour inherits the building and only
--    the deliberate overrides are stored. The count of rows here is the count
--    of decisions a human actually made.
--
-- 2. `is_available` is a boolean rather than the table being unavailable-only.
--    The rows that exist today all say false, but "this hallway is available
--    second hour because the Primary uses it for singing time" is the same
--    fact in the other direction, and storing it needs a column, not a table.
--    Effective availability is therefore: this row if there is one, else
--    building_rooms.is_assignable. That resolution lives in src/lib/building.ts
--    (roomAvailability) so the map, the panel and the API agree on it.
--
-- ON DELETE CASCADE on both sides, unlike room_assignments.slot_id which is
-- RESTRICT. An override is a preference about a room in an hour; it has no
-- meaning once either of them is gone, and refusing to delete an hour because
-- somebody once ticked a box would be an obstacle with nothing behind it.

CREATE TABLE room_slot_availability (
  room_key     text NOT NULL REFERENCES building_rooms(key) ON UPDATE CASCADE ON DELETE CASCADE,
  slot_id      uuid NOT NULL REFERENCES meeting_slots(id) ON DELETE CASCADE,
  -- True and false are both meaningful; see decision 2. NULL is not a state —
  -- "no opinion" is the absence of the row.
  is_available boolean NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text,
  PRIMARY KEY (room_key, slot_id)
);

-- The map reads one whole hour at a time, the same access pattern
-- room_assignments_slot_idx serves. The primary key already covers the panel's
-- per-room read.
CREATE INDEX room_slot_availability_slot_idx ON room_slot_availability(slot_id, room_key);
