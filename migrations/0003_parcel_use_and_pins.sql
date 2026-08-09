-- Two changes.
--
-- 1. Replace the is_residential boolean with a use_type enum.
--    A boolean cannot express "this parcel has a street address but nobody lives
--    there" — a business. is_residential was derived from a blank PARCEL_ADD,
--    which only ever identified roads and common areas.
--
-- 2. Let a household exist without a parcel.
--    Some homes have no county parcel polygon at all. Inventing synthetic parcel
--    rows for them would put them permanently at war with the monthly import,
--    which reconciles `parcels` against the county layer. Instead a household is
--    anchored by EITHER a parcel_id OR a point, and the import never looks at it.

CREATE TYPE parcel_use AS ENUM ('residence', 'business', 'common_area');

ALTER TABLE parcels ADD COLUMN use_type parcel_use NOT NULL DEFAULT 'residence';
ALTER TABLE parcels ADD COLUMN business_name text;

-- Carry the existing derivation across: blank address meant not a residence.
-- The literals are `unknown` and the CASE resolves to text, so the enum cast
-- has to be explicit.
UPDATE parcels
SET use_type = (CASE WHEN is_residential THEN 'residence' ELSE 'common_area' END)::parcel_use;

ALTER TABLE parcels DROP COLUMN is_residential;

-- Households no longer require a parcel, but must be locatable somehow.
ALTER TABLE households ALTER COLUMN parcel_id DROP NOT NULL;
ALTER TABLE households ADD COLUMN location geometry(Point, 4326);
ALTER TABLE households ADD CONSTRAINT households_anchored_ck
  CHECK (parcel_id IS NOT NULL OR location IS NOT NULL);

CREATE INDEX households_location_idx ON households USING GIST (location)
  WHERE location IS NOT NULL;
