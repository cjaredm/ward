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
property type, business name or `in_ward` (tracked in `parcels.ward_edited_at`, stamped by the
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

## Monthly refresh

UGRC republishes the county layer monthly. Before each refresh:

```sh
npm run test:clobber     # proves the import does not destroy household data
npm run import:parcels
```

`test:clobber` seeds a household plus the manual `in_ward` / `use_type` / `business_name` /
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
