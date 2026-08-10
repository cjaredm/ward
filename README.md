# Ward Parcel Map

Private map of Washington County parcels inside one LDS ward boundary, with editable household data.
Next.js 15 · Neon Postgres + PostGIS · MapLibre GL · deployed on Vercel.

See [Plan.md](Plan.md) for the product spec.

## Privacy

This app stores names, home addresses, phone numbers and email addresses of church members,
including minors. It is gated by a single shared password, sends `X-Robots-Tag: noindex`,
disallows all crawlers, and is not connected to any Church system. `.env*` is gitignored —
a leaked `DATABASE_URL` is a full disclosure of everything above.

## First-time setup

### 1. Neon

1. New project at [console.neon.tech](https://console.neon.tech) — Postgres 17, region **AWS US West 2 (Oregon)**.
2. In the SQL Editor:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   ```
3. Copy **both** connection strings from the Connect dialog — the pooled one (host contains
   `-pooler`) and the direct one.

### 2. Local env

```sh
cp .env.example .env.local
npm run hash-password -- 'the shared ward password'   # prints WARD_APP_PASSWORD_HASH + AUTH_JWT_SECRET
```

Fill in `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct), and the two printed secrets.
Paste them exactly as printed — no quotes, no escaping — and don't leave the plaintext
password in the file.

`WARD_APP_PASSWORD_HASH` is the bcrypt hash **base64-encoded**, on purpose. Next.js runs
dotenv-expand over `.env` files, and a raw bcrypt hash starts with `$2b$12$` — those read as
variable references and expand to nothing, so the value silently truncates and every login
fails with "Incorrect password" while the password is fine. Escaping each `$` fixes `.env`
but Vercel's dashboard stores values literally, so the same secret would need two different
forms. Base64 has no `$` and is byte-identical everywhere.
[src/lib/password.ts](src/lib/password.ts) still accepts a raw hash where it survives intact,
and throws a specific error rather than a generic auth failure when it doesn't.

### 3. Load the data

```sh
npm run migrate          # applies migrations/*.sql once each
npm run seed:boundary    # geojson.json -> ward_boundary
npm run import:parcels   # UGRC county layer -> parcels, clipped to the boundary
npm run import:directory # optional: a ward directory export -> households + people
```

Expected import summary: **539 parcels kept**, 93 of them non-residential (blank `PARCEL_ADD`
— HOA common area, roads, retention basins). Verify the smoke-test parcel landed:

```sql
SELECT parcel_id, address FROM parcels WHERE address ILIKE '%PAINTED VISTA%';
```

### 4. Vercel

1. Push to a **private** GitHub repo, then import it at [vercel.com](https://vercel.com).
2. `vercel.json` already pins functions to `pdx1` (Portland) so they sit in the same AWS
   region as Neon — same-region hop instead of a cross-country round trip on every query.
3. Settings → Environment Variables: add everything from `.env.local` to all three
   environments. `DATABASE_URL_UNPOOLED` is **required** — the build runs
   `sync:boundary` against the direct endpoint (see below).

Push to `main` deploys. That is the whole pipeline.

## Redrawing the ward boundary

`geojson.json` is the source of truth for the boundary. To change it: edit the file, commit,
deploy. Nothing else.

`npm run build` runs [scripts/sync-boundary.ts](scripts/sync-boundary.ts), which makes the
database agree with the file and then re-imports parcels for the new outline. Run it by hand
with `npm run sync:boundary`.

It is cheap to leave in the build because it does nothing when nothing changed:
`ward_boundary.source_sha` holds the SHA-256 of the file the stored boundary came from, so an
unchanged file costs one query. The ArcGIS fetch and the re-import only happen on a build
where the outline actually moved.

**Nothing that holds ward data is ever deleted.** A county parcel that falls outside the new
boundary is kept — not removed — if it has households on it or if anyone has hand-set its
property type or `in_ward` (tracked in `parcels.ward_edited_at`, stamped by the
app on every parcel edit). Those parcels are listed at the end of the run for review. Shrinking
the ward hides nothing you typed in; hand-drawn parcels (`source = 'manual'`) are never touched
at all.

Guard rails:

- **Preview deploys do not sync.** Every branch carries its own `geojson.json`, and letting
  previews write would let a stale branch silently revert production's boundary. Production
  builds and local runs only.
- **Concurrent builds serialize** on a Postgres advisory lock; the second one finds the SHA
  current and no-ops.
- **A failed sync fails the build.** Deploying the old boundary after someone deliberately
  edited the file is the worse outcome. `BOUNDARY_SYNC=warn` downgrades it to a warning,
  `BOUNDARY_SYNC=off` skips it, `BOUNDARY_SYNC=force` runs it even on a preview.

Schema migrations are still **not** in the build — see [scripts/migrate.ts](scripts/migrate.ts).

## Loading a ward directory

[scripts/import-directory.ts](scripts/import-directory.ts) turns a printed directory export
into households, matching each family's address against the county parcels.

```sh
npm run import:directory                       # dry run — prints the plan, writes nothing
npm run import:directory -- --apply
npm run import:directory -- --apply --status active --no-people
```

Input is `data/directory.tsv`: `<name as printed><TAB><address as printed>`, one per line, name
split at the first comma. **`/data/` is gitignored** — it is a list of real names and home
addresses, and git history is forever.

Where each family lands:

| directory row | result |
| --- | --- |
| address matches a parcel | household on that parcel |
| address matches a parcel marked **business** | pin dropped at that parcel's centroid |
| address matches nothing, street is known | pin interpolated between its numbered neighbours |
| address matches nothing at all | pin parked at the ward centre |
| no address printed | pin parked at the ward centre |

Several families at one address become several households on one parcel — 1579 S Scenic Sunrise
Dr takes four. Two rows sharing an address *and* a surname become one household with two people.

Matching is by house number plus street name, with the directional and the street type used only
to break ties, so `1594 Amity Lane` finds `1594 S AMITY LN`. A one- or two-character typo in the
street name is forgiven within the same house number (`1651 E Sunscrest Cir` →
`1651 E SUNCREST CIR`). Anything genuinely ambiguous is pinned rather than guessed at, and every
non-exact match is printed for review.

Re-running adds nothing twice: a family already on that parcel, or already pinned with that
address, is skipped. The script only ever inserts — it never updates or deletes — so hand-edits
made in the app always win.

Pins parked at the ward centre are meant to be dragged onto their houses: press and drag a pin
on the map, on desktop or on a phone.

## Naming the businesses

A parcel marked **Business** holds a list of tenants — many per parcel, the same shape
households already have, because one unit on Sandhill Dr holds six of them. The first tenant is
the name the map prints; a shared unit prints `Knox AutoWurx  +5`. Edit them in the parcel panel.

[scripts/import-businesses.ts](scripts/import-businesses.ts) fills them in from
[Overture Maps](https://overturemaps.org) rather than by hand:

```sh
npm run import:businesses                      # dry run — prints the plan, writes nothing
npm run import:businesses -- --apply
npm run import:businesses -- --min-confidence 0.6
```

Input is `data/overture-places.json`, committed because it is public business names with no
member data in it. Regenerate it when the ward looks stale:

```sh
pip install duckdb && npm run fetch:places
```

Overture rather than OpenStreetMap because of coverage: OSM knows six businesses inside this
boundary and Utah's statewide address points know two. Overture carries the Meta and Microsoft
POI sets and knows about 140, which names roughly two thirds of the industrial park. The data is
CC BY 4.0; imported rows are labelled *From Overture Maps* in the panel until somebody edits
them, at which point they become hand-entered and no re-import will touch them.

Each POI matches a parcel by coordinate first, and by county address second — one POI in six is
geocoded to the street or the wrong end of a building. An address-only match is only ever
allowed onto a parcel **already marked as a business**: it is not strong enough to put a shop
name on somebody's house. Parcels that already have a tenant are skipped entirely, which covers
both hand-typed names and a tenant somebody deliberately deleted.

## Satellite

The Map / Satellite toggle in the legend switches the basemap to Esri World Imagery — no API key,
attribution shown on the map — with OpenFreeMap's roads, street names and place labels still
drawn on top, so it is a hybrid rather than bare photos. The choice is remembered per device.

[`applySatellite`](src/lib/map-style.ts) edits the live style in place instead of swapping
styles: `setStyle` would tear down the parcel source and rebuild it, flashing the whole ward and
dropping the selection. It hides everything that paints ground, slots the imagery under the
first road line, flips labels to white-on-dark, and hands back a function that puts all of it
back.

Imagery stops at z19 here, which is why the source is capped there — uncapped, MapLibre asks for
z20 and gets blank tiles instead of overzooming the z19 ones.

Esri's capture does not sit exactly on the county's survey — over this ward it is about **four
metres north**, enough that every lot reads as sitting south of its house. That correction is
applied by default (`DEFAULT_IMAGERY_NUDGE` in [src/lib/map-style.ts](src/lib/map-style.ts)); nobody
has to know it exists.

The control that changes it is folded behind **Imagery alignment** at the bottom of the tools
card, visible only in satellite. It is a one-time calibration, not a field control — the reason to
open it is Esri reflying the area. Arrows move the photo in one-metre steps, the reading resets to
the built-in default, and an adjustment is remembered per device.

MapLibre has no `raster-translate`, so the correction moves the ward layers the other way with
`fill-translate` / `line-translate` / `circle-translate` / `text-translate` — the same picture, and a
paint property, so nothing in the database moves. `*-translate` is in screen pixels, which would
be the wrong ground distance at every zoom but one; a metre is worth twice as many pixels per
zoom level, so an `["exponential", 2]` zoom interpolation between two stops holds the offset at a
constant distance on the ground (verified exact from z12 to z22).

Anything written from a map click — a dropped pin, a traced outline, a dragged pin — has the
offset subtracted back off first, so what you point at is what gets stored. `queryRenderedFeatures`
already accounts for translate, so taps still select the parcel you can see.

## Monthly refresh

UGRC republishes the county layer monthly. Before each refresh:

```sh
npm run test:clobber     # proves the import does not destroy household data
npm run import:parcels
```

`test:clobber` seeds a household plus a business plus the manual `in_ward` / `use_type` /
`ward_edited_at` overrides on a **county** parcel, re-runs the import, and asserts everything
survived. If it fails, **do not run the refresh** — the import is eating months of hand-entered
work.

## Notes

- **Migrations never run in the Vercel build.** Builds run on every preview and can run
  concurrently; concurrent schema migrations corrupt databases. Run `npm run migrate` from a
  terminal before pushing code that needs it. The boundary sync is different and does run in the
  build — it is idempotent, SHA-gated and lock-protected; see above.
- The app runtime uses the Neon **HTTP** driver ([src/lib/db.ts](src/lib/db.ts)); scripts use a
  plain `pg` TCP client on the direct URL ([scripts/lib/pg.ts](scripts/lib/pg.ts)). Both on
  purpose — see the comments in each.
- `/api/parcels` ships the whole ward as one GeoJSON FeatureCollection (~320 KB, 52 KB gzipped).
  No vector tiles: at 539 parcels a tile pyramid solves a problem that does not exist.
- `npm audit` reports 3 high findings in Next 15's own transitive `postcss` and `sharp`. Both
  are build-time; clearing them requires Next 16, which the spec pins against.
