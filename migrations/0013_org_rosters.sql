-- Roster membership: who *belongs* to an organization, not just who serves in it.
--
-- `person_orgs` was written only by the callings import, so an org's membership
-- was its leadership. That answers "who runs Primary" and not "whose children
-- are in Valiant 9" — and the second question is the one the map is for.
--
-- LCR prints the answer. The "Organizations and Callings" report has a members
-- variant: a roster per organization and per class, names only. Two things have
-- to change for it to land here.
--
-- 1. A class is not an org. 'Gatherers of Light' and 'Deacons Quorum' are seeded
--    orgs, but 'Course 15', 'Valiant 9' and 'Primary Activities - Boys 9 & 10'
--    are ward-specific and renumber every January. Seeding each as an org would
--    mean a migration a year and a colour nobody picked. So membership gets a
--    `unit`, exactly like `callings.unit` already has, and '' means the
--    organization itself rather than a class inside it.
--
-- 2. Both imports assert memberships, and sometimes the same one — the Elders
--    Quorum President is on the callings report and on the Elders Quorum roster.
--    Rather than reconcile two writers into one row, `source` joins the primary
--    key. Each import owns its own rows, so a roster re-import can delete what
--    the last roster said without touching what the callings report said, and
--    readers take the DISTINCT of the org keys.
ALTER TABLE person_orgs ADD COLUMN unit text NOT NULL DEFAULT '';

ALTER TABLE person_orgs DROP CONSTRAINT person_orgs_pkey;
ALTER TABLE person_orgs ADD PRIMARY KEY (person_id, org_key, unit, source);

-- The map's group index reads every row and groups by (org, unit); the person
-- lookups on the household and parcel panels read one person at a time.
CREATE INDEX person_orgs_org_idx ON person_orgs(org_key, unit);
