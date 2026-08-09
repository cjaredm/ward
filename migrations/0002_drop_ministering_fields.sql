-- Drop the ministering/organization fields. Status stays.
--
-- Verified empty before writing this migration: 0 non-null values across all
-- households. Nothing is lost. If that ever stops being true, back the columns
-- up first — DROP COLUMN is not reversible.

ALTER TABLE households
  DROP COLUMN ministering_companionship,
  DROP COLUMN ministering_district,
  DROP COLUMN organization_group;
