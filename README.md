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

### 3. Load the data

```sh
npm run migrate          # applies migrations/*.sql once each
npm run seed:boundary    # geojson.json -> ward_boundary
npm run import:parcels   # UGRC county layer -> parcels, clipped to the boundary
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
   environments. `DATABASE_URL_UNPOOLED` is only needed if you later expose the admin
   re-import route.

Push to `main` deploys. That is the whole pipeline.

## Monthly refresh

UGRC republishes the county layer monthly. Before each refresh:

```sh
npm run test:clobber     # proves the import does not destroy household data
npm run import:parcels
```

`test:clobber` seeds a household plus manual `in_ward` / `is_residential` overrides, re-runs
the import, and asserts everything survived. If it fails, **do not run the refresh** — the
import is eating months of hand-entered work.

## Notes

- **Migrations never run in the Vercel build.** Builds run on every preview and can run
  concurrently; concurrent schema migrations corrupt databases. Run `npm run migrate` from a
  terminal before pushing code that needs it.
- The app runtime uses the Neon **HTTP** driver ([src/lib/db.ts](src/lib/db.ts)); scripts use a
  plain `pg` TCP client on the direct URL ([scripts/lib/pg.ts](scripts/lib/pg.ts)). Both on
  purpose — see the comments in each.
- `/api/parcels` ships the whole ward as one GeoJSON FeatureCollection (~320 KB, 52 KB gzipped).
  No vector tiles: at 539 parcels a tile pyramid solves a problem that does not exist.
- `npm audit` reports 3 high findings in Next 15's own transitive `postcss` and `sharp`. Both
  are build-time; clearing them requires Next 16, which the spec pins against.
