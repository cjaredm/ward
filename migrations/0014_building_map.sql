-- The building map: rooms in the stake center, and the classes that meet in them.
--
-- The ward map answers "where do people live" and the org chart answers "who
-- serves where". Neither answers the question somebody actually has while
-- standing in a hallway on a Sunday: which room is Course 15 in this hour, and
-- which rooms are sitting empty. That needs three facts the database has never
-- held — the shape of a room, the blocks a Sunday is divided into, and which
-- class is in which room during which block.
--
-- Four decisions are worth spelling out, because each of them has an obvious
-- alternative that breaks later.
--
-- 1. The geometry is jsonb, not PostGIS. A room outline is a ring of SVG user
--    units on the 2252x1183 drawing, with Y pointing DOWN. There is no SRID that
--    is honest about that. The danger is not that PostGIS would fail — it is
--    that it would appear to work: ST_Area(geom::geography) on these numbers
--    returns a plausible figure that means nothing, ST_MakeValid would repair
--    "degrees", and winding is inverted against SVG's. `parcels` uses PostGIS
--    because a parcel really is a geographic object; a room is not. The maths
--    lives in src/lib/floorplan-geom.ts instead, where a test script covers it.
--
-- 2. A meeting slot is referenced by an opaque uuid, never by its label or its
--    time. The 9:10 block becomes the 9:15 block every time the stake reshuffles
--    the schedule, and that has to be an UPDATE of one row here rather than a
--    rewrite of every assignment that named the old string.
--
-- 3. An assignment's `title` is free text, and its link to an organization is
--    optional. Classes renumber every January — 'Course 15' is not an org, and a
--    one-off combined youth meeting is not one either. But when the class IS one
--    the ward has data for, (org_key, unit) is exactly the pair person_orgs and
--    callings already key classes on (see 0013), so resolving a room's roster and
--    its teachers later is a join rather than a migration.
--
-- 4. Uniqueness is per (room, slot, TITLE), not per (room, slot). A room holding
--    two classes at once is normal, not a mistake: '104 / 105 / 106' is one
--    traced outline over three real rooms, and the cultural hall gets divided by
--    a curtain. Constraining that away means a migration the first Sunday it
--    happens. What the index does stop is the double-tap duplicate, which is a
--    live bug class in an app with no request deduplication. The clash worth
--    reporting is one class in two rooms in the same hour, and that is a warning
--    the API returns, not an error the database raises.
--
-- Room rows are NOT seeded here. The ~35 outlines are derived from the starter
-- drawing by scripts/seed-building.ts, which inserts ON CONFLICT DO NOTHING so
-- that re-running it can never revert an outline corrected by hand in the UI. A
-- migration could not offer that, and 35 rows of machine-generated coordinates
-- are unreviewable as prose anyway.

CREATE TABLE building_rooms (
  -- Slug from the drawing's own SVG ids: 'room-high-council' -> 'high-council'.
  -- Text rather than a uuid so a link reads /building?room=101 and the seed is
  -- re-runnable against known keys. ON UPDATE CASCADE below makes a rekey safe.
  key           text PRIMARY KEY,
  -- Not unique: the drawing already has three rooms called "Bishop's Office".
  -- The key is the identity; the name is only what gets printed.
  name          text NOT NULL,
  -- [[x,y], ...] in floorplan units. Open ring — the closing point is implied,
  -- so a reshape cannot leave a stale duplicate of the first vertex behind.
  points        jsonb NOT NULL,
  -- Where the label hangs when the computed anchor is wrong. NULL = computed.
  label_x       double precision,
  label_y       double precision,
  -- False for hallways, the serving area and the platform. They are on the
  -- drawing because the drawing is the building, but nothing meets in them, and
  -- without this flag they sit in "rooms free this hour" forever.
  is_assignable boolean NOT NULL DEFAULT true,
  sort          int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  -- Three points is the minimum that encloses any area. Checked here as well as
  -- in Zod because a two-point room is invisible rather than obviously broken.
  CONSTRAINT building_rooms_points_ring
    CHECK (jsonb_typeof(points) = 'array' AND jsonb_array_length(points) >= 3)
);

CREATE TABLE meeting_slots (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL means "derive it from the times", which is what almost every ward
  -- wants. The override exists because some say '2nd hour' or 'Sunday School'.
  label     text,
  starts_at time NOT NULL,
  ends_at   time NOT NULL,
  sort      int NOT NULL DEFAULT 0,
  -- A block that is not meeting this year, without losing what met in it.
  -- Deleting a slot is refused while anything references it; this is the way out.
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT meeting_slots_span CHECK (ends_at > starts_at)
);

CREATE INDEX meeting_slots_sort_idx ON meeting_slots(sort, starts_at);

CREATE TABLE room_assignments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_key   text NOT NULL REFERENCES building_rooms(key) ON UPDATE CASCADE ON DELETE CASCADE,
  -- RESTRICT, not CASCADE: deleting an hour must not silently take the whole
  -- Sunday's schedule with it. The API refuses and points at is_active instead.
  slot_id    uuid NOT NULL REFERENCES meeting_slots(id) ON DELETE RESTRICT,
  -- Authoritative for display, always. 'Course 15', 'Relief Society',
  -- 'Youth combined'.
  title      text NOT NULL,
  -- The optional link into the roster model. RESTRICT matches every other orgs
  -- foreign key in this schema (0009, 0013); orgs are seeded and never deleted.
  org_key    text REFERENCES orgs(key) ON DELETE RESTRICT,
  -- '' means the organization itself rather than a class inside it, exactly as
  -- person_orgs.unit and callings.unit already mean it.
  unit       text NOT NULL DEFAULT '',
  notes      text,
  sort       int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  -- A unit with no org resolves to nothing, so it is not allowed to exist.
  CONSTRAINT room_assignments_unit_needs_org CHECK (org_key IS NOT NULL OR unit = '')
);

-- See decision 4 in the header: this catches the double-tap, not the double-booking.
CREATE UNIQUE INDEX room_assignments_unique_idx ON room_assignments(room_key, slot_id, title);
-- The map reads one whole slot at a time; the panel reads one room at a time.
CREATE INDEX room_assignments_slot_idx ON room_assignments(slot_id, room_key, sort);
-- The roster phase will read (org_key, unit); rows with no link never match it.
CREATE INDEX room_assignments_org_idx ON room_assignments(org_key, unit) WHERE org_key IS NOT NULL;

-- The two blocks the ward meets in today. Unlabelled, so they read as their
-- times and stay correct when an admin edits them.
INSERT INTO meeting_slots (label, starts_at, ends_at, sort) VALUES
  (NULL, '09:10', '09:35', 10),
  (NULL, '09:40', '10:05', 20);
