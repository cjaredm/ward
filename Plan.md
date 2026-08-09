# Ward Parcel Map — Build Plan

**Handoff document for Claude Code.** Read this whole file before writing code.

---

## 0. What we're building

A private, password-protected web app showing the **real county parcel boundaries** for every property inside one LDS ward boundary in Washington, Utah. Each parcel is clickable. Clicking opens a panel where an authorized user edits household info (family name, contacts, ministering assignment, status, notes). Parcels are color-coded by whichever attribute the user picks from a dropdown.

Audience: ward council / clerks. Maybe 5–15 users, ~400–900 parcels. This is a small app. **Resist over-engineering it.**

**Stack (decided, don't re-litigate):**

| Layer | Choice |
|---|---|
| Framework | Next.js 15, App Router, TypeScript |
| Styling | Tailwind CSS v4 |
| DB | Neon Postgres + PostGIS extension |
| DB access | `@neondatabase/serverless` with raw SQL (spatial), Drizzle ORM optional for non-spatial tables |
| Map | MapLibre GL JS (via `react-map-gl/maplibre`) |
| Basemap | OpenFreeMap (`https://tiles.openfreemap.org/styles/liberty`) — free, no API key. Optional satellite toggle: Esri World Imagery raster tiles |
| Auth | Shared password → signed JWT in httpOnly cookie (`jose`) |
| Host | Vercel |

Total running cost at this scale: **$0** (Neon free tier, Vercel Hobby, OpenFreeMap free).

---

## 1. Parcel data source — VERIFIED, use exactly this

Utah Geospatial Resource Center (UGRC) publishes Washington County's parcel layer as a public, no-auth ArcGIS Feature Service under CC-BY 4.0. It is refreshed **monthly** (Washington is one of the "Big 5" priority counties).

**Endpoint:**

```
https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Washington/FeatureServer/0
```

**Confirmed working query** (this exact request was tested and returns valid GeoJSON):

```
GET {ENDPOINT}/query
  ?where=PARCEL_ID='W-SSR-4-402'
  &outFields=PARCEL_ID,PARCEL_ADD
  &returnGeometry=true
  &outSR=4326
  &f=geojson
```

Returns the 13-vertex polygon for `1676 S PAINTED VISTA CIR` centered near `-113.4790, 37.1077`. Use this as your integration smoke test.

**Fields available** (this is the full set — the county deliberately withholds owner names from the public layer, which is fine, we don't need them):

| Field | Notes |
|---|---|
| `PARCEL_ID` | e.g. `W-SSR-4-402`. **This is your stable join key.** |
| `PARCEL_ADD` | e.g. `1676 S PAINTED VISTA CIR`. This is the street address you asked for. |
| `PARCEL_CITY` | `Washington` |
| `PARCEL_ZIP` | `84780` |
| `ACCOUNT_NUM` | County tax account number |
| `OWN_TYPE` | Generalized only: `Private` / `Federal` / `State` / `Tribal` |
| `ParcelsCur` | Epoch ms — when county data was current as of |
| `CoParcel_URL` | Link to county's public parcel viewer |
| `OBJECTID` | **Do NOT use as a key** — it is regenerated on every county refresh |

**Service constraints you must handle:**

- `maxRecordCount: 2000` → paginate with `resultOffset` + `resultRecordCount`
- Native SRID is `102100` / EPSG:3857 → **always pass `outSR=4326`**
- `supportedQueryFormats` includes `geoJSON` → request `f=geojson`, skip Esri JSON conversion entirely
- `capabilities: "Query,Extract"` → read-only, as expected
- Supports `esriSpatialRelIntersects` with a polygon geometry
- Geometry may come back as `Polygon` or `MultiPolygon` → normalize to MultiPolygon on insert

**Fallback if UGRC is ever down:** Washington County runs its own ArcGIS server at `https://agisprodvm.washco.utah.gov/arcgis/rest/services/Parcels/MapServer`. Same data, less convenient. Don't build against it unless UGRC fails.

---

## 2. The ward boundary — do this first, it blocks everything

We do not have a machine-readable ward boundary. The Church's map tool has no public API. You need a polygon in `data/ward-boundary.geojson` (EPSG:4326).

**Recommended approach — trace it once, by hand:**

1. Open [geojson.io](https://geojson.io), switch to satellite basemap, navigate to Washington, UT near `37.1077, -113.4790`.
2. Draw the ward boundary polygon using the reference screenshot the user provided (blue outline).
3. Save as `data/ward-boundary.geojson`.

Rough starting extent from the reference image, for orientation only — **verify and correct against the screenshot, do not trust these numbers**:

```
west  ≈ -113.492   (near Arabian Way E / S Camino Real)
east  ≈ -113.462   (a N–S line east of S Sandhill Dr, near S 1900 East)
south ≈  37.098    (near E Stable Way)
north ≈  37.122    (north of E Washington Dam Rd, near S 1725 East)
```

**Build a boundary editor into the app** (Phase 4) so the user can adjust it later without touching files — ward boundaries get redrawn. Use `@mapbox/mapbox-gl-draw` or MapLibre's draw plugin, persist the polygon to a `ward_boundary` table, and let re-import read from the DB.

**Accuracy note to surface in the UI:** parcels are clipped to the boundary polygon geometrically. Real ward boundaries follow streets and lot lines in ways a hand-traced polygon won't perfectly match. Expect a handful of edge parcels to be wrong. Give the user a per-parcel **"exclude from ward"** toggle so they can fix these by hand instead of re-tracing.

---

## 3. Database schema

Enable PostGIS on Neon first — it is supported:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- fuzzy address/name search
```

### Core design rule

**County data and ward data live in separate tables.** `parcels` is a disposable mirror of the county layer, wiped and re-imported monthly. `households` is the ward's hand-entered data, joined by `parcel_id`, and must never be touched by the import. Getting this wrong means an import destroys months of work.

```sql
-- Mirror of county data. Safe to truncate and re-import.
CREATE TABLE parcels (
  parcel_id        text PRIMARY KEY,          -- county PARCEL_ID, e.g. 'W-SSR-4-402'
  address          text,                      -- PARCEL_ADD
  city             text,
  zip              text,
  account_num      text,
  own_type         text,
  geom             geometry(MultiPolygon, 4326) NOT NULL,
  centroid         geometry(Point, 4326) NOT NULL,
  area_sqm         double precision,
  county_current_at timestamptz,              -- from ParcelsCur
  imported_at      timestamptz NOT NULL DEFAULT now(),
  in_ward          boolean NOT NULL DEFAULT true  -- manual override for edge parcels
);
CREATE INDEX parcels_geom_idx     ON parcels USING GIST (geom);
CREATE INDEX parcels_centroid_idx ON parcels USING GIST (centroid);
CREATE INDEX parcels_address_trgm ON parcels USING GIN (address gin_trgm_ops);

-- Ward data. NEVER touched by import.
CREATE TYPE household_status AS ENUM (
  'active', 'less_active', 'move_in', 'moved_out', 'not_member', 'vacant', 'unknown'
);

CREATE TABLE households (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id     text NOT NULL REFERENCES parcels(parcel_id) ON DELETE RESTRICT,
  family_name   text NOT NULL,
  status        household_status NOT NULL DEFAULT 'unknown',
  -- organization
  ministering_companionship text,
  ministering_district      text,
  organization_group        text,   -- EQ / RS / etc.
  -- free-form
  notes         text,
  -- audit
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);
-- NOTE: intentionally NOT unique on parcel_id.
-- Duplexes, ADUs, and apartment parcels hold multiple households.
CREATE INDEX households_parcel_idx ON households(parcel_id);
CREATE INDEX households_name_trgm  ON households USING GIN (family_name gin_trgm_ops);

CREATE TABLE people (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  full_name     text NOT NULL,
  role          text,      -- 'head' | 'spouse' | 'child' | 'other'
  phone         text,
  email         text,
  sort_order    int NOT NULL DEFAULT 0
);
CREATE INDEX people_household_idx ON people(household_id);

CREATE TABLE ward_boundary (
  id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
  geom       geometry(Polygon, 4326) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor      text,
  action     text NOT NULL,     -- 'update_household' | 'create_household' | ...
  entity_id  text,
  diff       jsonb
);
```

---

## 4. Import script

`scripts/import-parcels.ts`, run with `tsx`. Idempotent — safe to re-run monthly.

**Algorithm:**

1. Load boundary polygon from `ward_boundary` table (fall back to `data/ward-boundary.geojson` on first run).
2. Compute its bounding box.
3. Page through the ArcGIS service using the boundary polygon as the spatial filter:
   - **Use `POST` with form-encoded body, not `GET`.** A ward polygon serialized as Esri JSON will blow past URL length limits.
   - Params: `f=geojson`, `outSR=4326`, `outFields=*`, `returnGeometry=true`, `geometryType=esriGeometryPolygon`, `inSR=4326`, `spatialRel=esriSpatialRelIntersects`, `resultRecordCount=2000`, `resultOffset=N`
   - Loop until `exceededTransferLimit` is absent/false.
4. Normalize each feature: `Polygon` → `MultiPolygon`, compute centroid, compute area.
5. **Precise clip in PostGIS, not in JS.** ArcGIS `Intersects` catches parcels that merely touch the edge. After loading into a staging table, keep only parcels whose *centroid* falls inside the boundary:
   ```sql
   DELETE FROM parcels_staging s
   USING ward_boundary w
   WHERE NOT ST_Contains(w.geom, s.centroid);
   ```
   Centroid-based inclusion matches how people think about "which ward is this house in" far better than any-overlap.
6. Upsert into `parcels` on `parcel_id`:
   - `ON CONFLICT (parcel_id) DO UPDATE` — refresh geometry/address, but **preserve `in_ward`**.
   - Do NOT delete parcels that have households attached. Instead mark them and report.
7. Print a summary: fetched, kept after clip, inserted, updated, orphaned-with-households (needs human review).

**Add `npm run import:parcels` to package.json.** Also expose it as an authenticated admin API route so the user can refresh monthly from the UI without a terminal.

---

## 5. API routes

All under `/api`, all gated by auth middleware.

| Route | Method | Behavior |
|---|---|---|
| `/api/auth/login` | POST | Body `{ password, name }`. Compare against `bcrypt` hash in env. Set httpOnly, `SameSite=Strict`, `Secure` JWT cookie (7d) carrying `{ name }`. |
| `/api/auth/logout` | POST | Clear cookie. |
| `/api/parcels` | GET | Returns **one GeoJSON FeatureCollection** of all in-ward parcels with joined household summary (family name, status, district, household count). Cache with `s-maxage=60, stale-while-revalidate`. |
| `/api/households/:parcelId` | GET | Full detail incl. people array. |
| `/api/households` | POST | Create household on a parcel. |
| `/api/households/:id` | PATCH | Update fields + nested people. Zod-validate. Write `audit_log`. |
| `/api/households/:id` | DELETE | Soft-delete preferred. |
| `/api/parcels/:parcelId/in-ward` | PATCH | Toggle edge-parcel inclusion. |
| `/api/boundary` | GET/PUT | Read/write ward boundary polygon. |
| `/api/export` | GET | CSV of all households + people + addresses. |
| `/api/admin/reimport` | POST | Kick off parcel import. |

### Critical performance note

**Do not build vector tiles. Do not use PostGIS MVT.** At ~900 parcels the entire ward serializes to roughly 1–3 MB of GeoJSON, and under 500 KB if you round coordinates to 6 decimal places (`ST_ReducePrecision(geom, 0.000001)`). Ship it as one request, hand it to MapLibre as a `geojson` source, done. Anyone reaching for tile pyramids here is solving a problem you don't have.

---

## 6. Frontend

### Pages

- `/login` — password + "your name" field (name is used for the audit trail, not authentication)
- `/` — full-screen map, the main surface
- `/list` — sortable/filterable table of all households, CSV export
- `/admin` — boundary editor, re-import trigger, audit log

### Map behavior

- Fill layer over parcel polygons, driven by a **"Color by" dropdown**: Status / Ministering district / Has household vs. empty / Organization group.
- Use MapLibre data-driven styling (`fill-color` with a `match` expression on a feature property). Do not re-render the source on filter change — just swap the paint expression.
- Fill opacity ~0.55, distinct outline, hover highlight, thick outline on selected parcel.
- Symbol layer with family name labels above ~z16.
- Click parcel → right side panel slides in (bottom sheet on mobile).
- Legend synced to the active "Color by" dimension.
- Search box: fuzzy match on address *and* family name via `pg_trgm`, `flyTo` the result and select it.
- Filter chips to hide statuses.

### Detail panel

- **Read-only header** from county: address, `PARCEL_ID`, link to `CoParcel_URL`. Make it visually obvious this is county data and not editable.
- Editable: family name, status dropdown, ministering companionship, district, organization group, notes textarea.
- People sub-list: add/remove rows with name, role, phone (`tel:` link), email (`mailto:` link).
- Parcel with zero households → "Add household" empty state. Parcel with multiple → tabs.
- **Autosave on blur with optimistic UI**, plus an explicit Save button. Show "Saved · 2m ago by Jared". Ward members will use this on phones in a parking lot; don't lose their input to a dropped connection.

### Mobile

Treat mobile as a first-class target, not an afterthought. Ministering assignments get looked up from a car.

---

## 7. Auth & privacy

This app stores names, home addresses, and phone numbers of church members, including minors. Treat it accordingly.

**Required:**

- Single shared password, stored as a **bcrypt hash** in `WARD_APP_PASSWORD_HASH`. Never a plaintext env var.
- `middleware.ts` protects every route except `/login` and static assets. Verify JWT on every API request server-side — never trust a client-side check.
- `X-Robots-Tag: noindex, nofollow` on all responses; `robots.txt` disallowing everything.
- Rate-limit `/api/auth/login` (in-memory counter is fine at this scale).
- Never log request bodies containing PII. Scrub before any error reporting.
- HTTPS only (Vercel default). `Secure` + `HttpOnly` + `SameSite=Strict` cookie.
- Add a visible "Delete this household" action so removal requests are one click.
- Put a short privacy notice on the login page: what's stored, who can see it, who to contact for removal.

**Explicitly out of scope:** do not add public sharing links, do not add an "invite by email" flow, do not integrate with Church systems or attempt to scrape Church membership tools. Data entry is manual and deliberate.

---

## 8. Environment variables

```
DATABASE_URL=                  # Neon pooled connection string
WARD_APP_PASSWORD_HASH=        # bcrypt hash of shared password
AUTH_JWT_SECRET=               # 32+ random bytes
NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
PARCEL_SERVICE_URL=https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Washington/FeatureServer/0
```

Include a `scripts/hash-password.ts` helper so the user can generate the hash without googling bcrypt.

---

## 9. Build order

Ship something usable at Phase 3. Phases 4–6 are polish.

**Phase 1 — Data foundation**
- Neon project, PostGIS enabled, migrations applied
- `data/ward-boundary.geojson` traced
- Import script runs, parcels in DB
- ✅ Done when: `SELECT count(*) FROM parcels` returns a plausible number (expect 400–900) and the `1676 S PAINTED VISTA CIR` parcel is present.

**Phase 2 — Map read-only**
- Next.js app, login + middleware
- `/api/parcels` returns GeoJSON, MapLibre renders it
- ✅ Done when: parcels render as distinct polygons over the correct streets, and clicking one shows its address.

**Phase 3 — Editing** ← *minimum shippable*
- Detail panel, household CRUD, people sub-list, autosave, audit log
- ✅ Done when: the user can click their own house, enter their family, reload, and see it persisted.

**Phase 4 — Organization**
- "Color by" dropdown, legend, filters, search, `/list` + CSV export

**Phase 5 — Admin**
- Boundary editor, in-app re-import, `in_ward` toggle for edge parcels

**Phase 6 — Polish**
- Mobile refinement, satellite toggle, print-friendly ward map, keyboard nav

---

## 10. Gotchas — read before debugging

1. **`OBJECTID` is not stable.** It changes on every county refresh. Join on `PARCEL_ID` only.
2. **SRID mismatch is the #1 time sink.** Service is natively 3857. Always `outSR=4326`, always store 4326, always confirm with `ST_SRID()` after insert.
3. **Polygon vs MultiPolygon.** ArcGIS returns both. Normalize with `ST_Multi()` on insert or your typed column will reject rows.
4. **2000-record cap** is silent-ish — check `exceededTransferLimit` in the response, don't assume one page is everything.
5. **Long geometry in a GET URL will 414.** POST the import query.
6. **Multiple households per parcel is real**, not an edge case. Apartments and duplexes exist. Don't make `parcel_id` unique on `households`.
7. **Some parcels have null or empty `PARCEL_ADD`** — new subdivisions, common areas, retention basins. Handle gracefully; consider a "no address on file" display and let the user hide them.
8. **Not every parcel is a home.** HOA common areas, roads, and church property all come back as parcels. Give the user a way to hide non-residential ones rather than trying to auto-detect.
9. **Re-import must never clobber `households`.** Write a test for this before the first monthly refresh.
10. **Vercel Hobby is non-commercial** — a ward organizational tool qualifies, but if this ever grows beyond that, move to Pro.

---

## 11. Sources

- [UGRC — Utah Parcels](https://gis.utah.gov/products/sgid/cadastre/parcels/) — canonical documentation, county-by-county endpoints, refresh schedule
- [Washington County parcels feature service](https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Washington/FeatureServer/0) — the endpoint above
- [Utah Washington County Parcels — SGID open data](https://opendata.gis.utah.gov/datasets/01e2c63e81f6490982f0cdfa51df30e7_0/about) — metadata and license (CC-BY 4.0)
- [Washington County GIS](https://www.washco.utah.gov/departments/gis/) — county contact if the state layer lags
- [Washington County ArcGIS server](https://agisprodvm.washco.utah.gov/arcgis/rest/services) — fallback source