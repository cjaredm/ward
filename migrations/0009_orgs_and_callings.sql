-- Organizations and callings, so the ward has an org chart.
--
-- Three things arrive here, and they are deliberately three tables rather than
-- columns on `people`:
--
--   orgs         the organizations of a ward, as a tree. Seeded coarse (Elders
--                Quorum, Relief Society, Young Men, ...) with the few children
--                the LCR report already prints, so breaking an org down further
--                later is an INSERT, not a migration of live data.
--   person_orgs  which orgs a person belongs to. Many per person: a Primary
--                teacher is also in Relief Society.
--   callings     the specific calling(s) a person holds. Many per person —
--                Ryan Dahle is Ward Clerk *and* Elders Quorum Activity
--                Coordinator — so this cannot be a column either.
--
-- `people.role` is left alone. It holds the household relationship (head,
-- spouse, child) that the map panel has always shown; a calling is a different
-- fact about the same person and now lives in `callings`.

CREATE TABLE orgs (
  key        text PRIMARY KEY,                        -- 'elders_quorum'
  label      text NOT NULL,                           -- 'Elders Quorum'
  -- Nullable: top-level orgs have no parent. Children exist so that
  -- 'Deacons Quorum' can be shown under Young Men without inventing a second
  -- concept for sub-orgs.
  parent_key text REFERENCES orgs(key) ON DELETE RESTRICT,
  sort       int NOT NULL DEFAULT 0,                   -- display order among siblings
  CHECK (parent_key IS NULL OR parent_key <> key)
);
CREATE INDEX orgs_parent_idx ON orgs(parent_key, sort);

CREATE TABLE person_orgs (
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  org_key   text NOT NULL REFERENCES orgs(key) ON DELETE RESTRICT,
  -- 'import' rows were derived from a callings report; 'manual' ones were set in
  -- the app. The import only ever removes what it added.
  source    text NOT NULL DEFAULT 'manual',
  PRIMARY KEY (person_id, org_key)
);

CREATE TABLE callings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL is a vacancy. The LCR report prints 'Calling Vacant' rows and they are
  -- the most useful rows on the page for a bishopric, so the org chart keeps
  -- them rather than dropping them on import.
  person_id   uuid REFERENCES people(id) ON DELETE CASCADE,
  org_key     text NOT NULL REFERENCES orgs(key) ON DELETE RESTRICT,
  name        text NOT NULL,          -- 'Elders Quorum First Counselor'
  -- The sub-heading the calling was printed under: 'Valiant 9', 'Course 15',
  -- 'Ministering'. Two Primary Teachers are only distinguishable by this.
  unit        text,
  -- LCR marks locally-created callings with a leading '*'. Worth keeping: a
  -- custom calling is not a standard one and can be renamed by the ward.
  is_custom   boolean NOT NULL DEFAULT false,
  -- Report order, so the org chart lists a presidency as a presidency rather
  -- than alphabetically.
  sort        int NOT NULL DEFAULT 0,
  source      text NOT NULL DEFAULT 'manual',  -- 'manual' | 'lcr_import'
  -- Soft release: who held what stays answerable after a reorganization.
  released_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);
CREATE INDEX callings_org_idx    ON callings(org_key, sort) WHERE released_at IS NULL;
CREATE INDEX callings_person_idx ON callings(person_id)     WHERE released_at IS NULL;

-- One live row per (person, org, calling, unit). Re-running an import must not
-- stack a second copy of a calling somebody already holds. Vacancies are
-- excluded: an org can hold nine vacant Ward Missionary slots at once.
CREATE UNIQUE INDEX callings_unique_live_idx
  ON callings (person_id, org_key, name, coalesce(unit, ''))
  WHERE released_at IS NULL AND person_id IS NOT NULL;

-- One row per uploaded PDF, so "what did the last import change" has an answer
-- and re-uploading the same file is visible rather than mysterious.
CREATE TABLE import_batches (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL,            -- 'callings' | 'members'
  file_name  text,
  -- Counts only, never the parsed names: this table must not become a second
  -- copy of the member data that deleting a household is supposed to erase.
  stats      jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_batches_at_idx ON import_batches(created_at DESC);

-- Seed. Top-level orgs first, then the children the report already prints.
INSERT INTO orgs (key, label, parent_key, sort) VALUES
  ('bishopric',            'Bishopric',                  NULL, 10),
  ('elders_quorum',        'Elders Quorum',              NULL, 20),
  ('relief_society',       'Relief Society',             NULL, 30),
  ('young_men',            'Young Men',                  NULL, 40),
  ('young_women',          'Young Women',                NULL, 50),
  ('primary',              'Primary',                    NULL, 60),
  ('sunday_school',        'Sunday School',              NULL, 70),
  ('ward_missionaries',    'Ward Missionaries',          NULL, 80),
  ('temple_family_history','Temple and Family History',  NULL, 90),
  ('young_single_adult',   'Young Single Adult',         NULL, 100),
  ('other',                'Other Callings',             NULL, 110);

INSERT INTO orgs (key, label, parent_key, sort) VALUES
  ('priests_quorum',    'Priests Quorum',    'young_men',   10),
  ('teachers_quorum',   'Teachers Quorum',   'young_men',   20),
  ('deacons_quorum',    'Deacons Quorum',    'young_men',   30),
  ('gatherers_of_light','Gatherers of Light','young_women', 10),
  ('messengers_of_hope','Messengers of Hope','young_women', 20),
  ('builders_of_faith', 'Builders of Faith', 'young_women', 30),
  ('nursery',           'Nursery',           'primary',     10);
