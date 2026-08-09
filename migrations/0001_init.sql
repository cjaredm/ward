-- Ward Parcel Map — initial schema.
-- PostGIS and pg_trgm must already be enabled on the Neon project.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Mirror of the county parcel layer. Safe to truncate and re-import monthly.
CREATE TABLE parcels (
  parcel_id         text PRIMARY KEY,           -- county PARCEL_ID, e.g. 'W-SSR-4-402'
  address           text,                       -- PARCEL_ADD; blank on common areas, roads, basins
  city              text,
  zip               text,
  account_num       text,
  own_type          text,
  coparcel_url      text,
  geom              geometry(MultiPolygon, 4326) NOT NULL,
  centroid          geometry(Point, 4326) NOT NULL,
  area_sqm          double precision,
  county_current_at timestamptz,                -- from ParcelsCur (epoch ms)
  imported_at       timestamptz NOT NULL DEFAULT now(),
  -- Manual overrides. The import must PRESERVE both of these on conflict.
  in_ward           boolean NOT NULL DEFAULT true,
  is_residential    boolean NOT NULL DEFAULT true
);
CREATE INDEX parcels_geom_idx     ON parcels USING GIST (geom);
CREATE INDEX parcels_centroid_idx ON parcels USING GIST (centroid);
CREATE INDEX parcels_address_trgm ON parcels USING GIN (address gin_trgm_ops);

-- Ward data. NEVER touched by the import.
CREATE TYPE household_status AS ENUM (
  'active', 'less_active', 'move_in', 'moved_out', 'not_member', 'vacant', 'unknown'
);

CREATE TABLE households (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id     text NOT NULL REFERENCES parcels(parcel_id) ON DELETE RESTRICT,
  family_name   text NOT NULL,
  status        household_status NOT NULL DEFAULT 'unknown',
  ministering_companionship text,
  ministering_district      text,
  organization_group        text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  deleted_at    timestamptz                    -- soft delete
);
-- Intentionally NOT unique on parcel_id: duplexes, ADUs and apartment parcels
-- hold multiple households.
CREATE INDEX households_parcel_idx ON households(parcel_id) WHERE deleted_at IS NULL;
CREATE INDEX households_name_trgm  ON households USING GIN (family_name gin_trgm_ops);

CREATE TABLE people (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  full_name     text NOT NULL,
  role          text,                          -- 'head' | 'spouse' | 'child' | 'other'
  phone         text,
  email         text,
  sort_order    int NOT NULL DEFAULT 0
);
CREATE INDEX people_household_idx ON people(household_id);

CREATE TABLE ward_boundary (
  id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),   -- singleton
  geom       geometry(Polygon, 4326) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor      text,
  action     text NOT NULL,                    -- 'create_household' | 'update_household' | ...
  entity_id  text,
  diff       jsonb
);
CREATE INDEX audit_log_at_idx ON audit_log(at DESC);
