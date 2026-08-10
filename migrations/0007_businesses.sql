-- Businesses become rows, not a column.
--
-- `parcels.business_name` held one name per parcel. That is wrong the same way
-- one household per parcel was wrong: a single unit on Hillcrest Dr holds six
-- tenants, and a strip of suites shares one county parcel_id. So businesses get
-- the same shape households already have — many rows per parcel, joined back on
-- parcel_id — and the map label is derived from the first of them.
--
-- Unlike households these carry no PII and are re-importable from a public POI
-- dataset, so they hard-delete and cascade with the parcel instead of soft
-- deleting and blocking it.

CREATE TABLE businesses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id  text NOT NULL REFERENCES parcels(parcel_id) ON DELETE CASCADE,
  name       text NOT NULL,
  category   text,                                   -- 'automotive_repair', free text
  notes      text,
  -- Where the row came from. 'overture' rows were matched by scripts/import-businesses.ts;
  -- source_id is the Overture GERS id, which makes a re-import idempotent.
  source     text NOT NULL DEFAULT 'manual',
  source_id  text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

-- Intentionally NOT unique on parcel_id: multi-tenant units are the normal case.
CREATE INDEX businesses_parcel_idx ON businesses(parcel_id);
CREATE UNIQUE INDEX businesses_source_idx ON businesses(source, source_id)
  WHERE source_id IS NOT NULL;

-- Carry the hand-typed names across before the column goes.
INSERT INTO businesses (parcel_id, name, source, updated_by)
SELECT parcel_id, btrim(business_name), 'manual', 'migration 0007'
FROM parcels
WHERE business_name IS NOT NULL AND btrim(business_name) <> '';

ALTER TABLE parcels DROP COLUMN business_name;

-- Retyping a parcel away from 'business' used to null its name out, so that a
-- shop name could not end up printed on somebody's house. The tenant rows now
-- survive that instead: /api/parcels only emits a business label for parcels
-- whose use_type is still 'business', so retyping hides them and retyping back
-- brings them straight back.
