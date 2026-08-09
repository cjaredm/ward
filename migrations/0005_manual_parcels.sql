-- Hand-drawn parcels.
--
-- Some homes have no county parcel polygon. A dropped point locates them, but a
-- traced outline reads like every other property on the map.
--
-- These live in `parcels` alongside county rows rather than in a parallel table,
-- so households, the map layers and the detail panel all work unchanged. The
-- distinguishing column is `source`: the import reconciles ONLY source='county'
-- rows against the county layer, and never sees a manual one. Without this the
-- monthly refresh would delete every drawn parcel as "stale".

CREATE TYPE parcel_source AS ENUM ('county', 'manual');

ALTER TABLE parcels ADD COLUMN source parcel_source NOT NULL DEFAULT 'county';

-- Manual parcels carry no county attributes, so the columns the county fills are
-- simply left null. parcel_id for them is generated app-side as 'MANUAL-<uuid>'.
CREATE INDEX parcels_source_idx ON parcels (source) WHERE source = 'manual';
