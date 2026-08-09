/**
 * Copies maplibre-gl's worker bundle into public/.
 *
 * maplibre-gl v6 loads its worker from a separate file via
 * `new Worker(new URL('./maplibre-gl-worker.mjs', import.meta.url), {type:'module'})`.
 * Next's webpack build does not emit that file, so the URL resolves to a path
 * that 404s, the dev server answers with an HTML error page, and the browser
 * reports "Failed to load module script: non-JavaScript MIME type text/html".
 * The worker never starts, so no tiles and no parcels render.
 *
 * Serving it from public/ and calling maplibre's setWorkerUrl() sidesteps the
 * bundler entirely. Regenerated on every dev/build so it cannot drift from the
 * installed maplibre-gl version; public/maplibre-gl-worker.mjs is gitignored.
 *
 * Plain .mjs rather than TypeScript: this runs before next dev/build, so it must
 * not depend on tsx being resolvable.
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

const pkgPath = require.resolve('maplibre-gl/package.json')
const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version
const dist = join(dirname(pkgPath), 'dist')
const publicDir = join(process.cwd(), 'public')

// The worker is not self-contained: it does `import ... from "./maplibre-gl-shared.mjs"`,
// resolved relative to its own URL. Copy the sibling too or the worker 404s on
// its first import and dies silently.
const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']

mkdirSync(publicDir, { recursive: true })
for (const f of FILES) copyFileSync(join(dist, f), join(publicDir, f))

console.log(`maplibre-gl v${version} worker -> public/ (${FILES.join(', ')})`)
