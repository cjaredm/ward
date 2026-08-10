-- Rebuild-on-boundary-change, without losing anything already entered.
--
-- Two additions.
--
-- 1. ward_boundary.source_sha — the SHA-256 of the geojson.json the stored
--    boundary was built from. scripts/sync-boundary.ts compares the file against
--    it and does nothing when they agree, so wiring the sync into `npm run build`
--    costs one cheap query on a build where the boundary has not moved.
--
-- 2. parcels.ward_edited_at — when someone last hand-set use_type, business_name
--    or in_ward on this parcel.
--
--    The import deletes county parcels the county no longer returns inside the
--    boundary, and it already refuses to delete one that carries households. That
--    was not enough. Redrawing the boundary drops parcels out of range wholesale,
--    and a parcel someone spent an evening classifying as a business — with the
--    shop's name typed in — has real work in it and no household to protect it.
--    From here on, an edited parcel is kept and reported, never deleted.

ALTER TABLE ward_boundary ADD COLUMN source_sha text;

ALTER TABLE parcels ADD COLUMN ward_edited_at timestamptz;

-- Backfill from the audit log, which has recorded every parcel edit since day one.
UPDATE parcels p
SET ward_edited_at = a.at
FROM (
  SELECT entity_id, max(at) AS at
  FROM audit_log WHERE action = 'update_parcel' AND entity_id IS NOT NULL
  GROUP BY entity_id
) a
WHERE p.parcel_id = a.entity_id;

-- Bulk edits log the affected parcels inside diff->'prior', not in entity_id.
UPDATE parcels p
SET ward_edited_at = greatest(p.ward_edited_at, b.at)
FROM (
  SELECT at, jsonb_array_elements(diff -> 'prior') ->> 'parcel_id' AS parcel_id
  FROM audit_log
  WHERE action = 'bulk_update_parcels' AND jsonb_typeof(diff -> 'prior') = 'array'
) b
WHERE p.parcel_id = b.parcel_id;

-- Belt and braces for anything edited before the audit log covered it: a parcel
-- whose overrides differ from what the import would have derived from the county
-- address was set by hand, whatever the log says.
UPDATE parcels
SET ward_edited_at = coalesce(ward_edited_at, imported_at)
WHERE business_name IS NOT NULL
   OR in_ward = false
   OR use_type <> (CASE WHEN address IS NOT NULL AND btrim(address) <> ''
                        THEN 'residence' ELSE 'common_area' END)::parcel_use;

CREATE INDEX parcels_ward_edited_idx ON parcels (ward_edited_at)
  WHERE ward_edited_at IS NOT NULL;
