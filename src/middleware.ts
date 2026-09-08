import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_NAME, verifySession } from '@/lib/auth-edge'

/**
 * Pages anybody may load without a session.
 *
 * Checked here rather than carved out of the matcher below: that pattern is a
 * negative lookahead over path *prefixes*, and '/' is the prefix of everything
 * — excluding it there would open the whole app. An exact-match set says what
 * is meant and cannot be widened by accident.
 *
 * The landing page holds meeting times and public links only. /login is the
 * form itself and is excluded in the matcher, since it must stay reachable even
 * while this list is being edited.
 */
const PUBLIC_PATHS = new Set(['/'])

/**
 * Runs on the Edge runtime, so it only verifies the JWT (jose is Edge-safe).
 * The bcrypt comparison lives in the Node.js login route.
 */
export async function middleware(req: NextRequest) {
  if (PUBLIC_PATHS.has(req.nextUrl.pathname)) return NextResponse.next()

  const session = await verifySession(req.cookies.get(COOKIE_NAME)?.value)

  if (!session) {
    if (req.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   /login, /api/auth/*            the way in
     *   _next/*, favicon, robots       framework static assets
     *   maplibre-gl-*.mjs              vendored worker bundle served from public/;
     *                                  a redirect here answers a module-worker
     *                                  request with HTML and the map silently
     *                                  fails to render. Contains no ward data.
     *   manifest.webmanifest           the browser fetches it without cookies, so
     *                                  gating it answers with the /login HTML and
     *                                  Add to Home Screen breaks. Name and colours
     *                                  only — no ward data.
     *   floorplan/                     the stake centre wall drawing, served from
     *                                  public/ and cached by the service worker.
     *                                  Gated, it answers with /login HTML on an
     *                                  expired session and the worker caches that
     *                                  page *as the SVG* — the drawing then never
     *                                  renders again until the cache is dropped.
     *                                  Architectural linework only, no ward data.
     *   sw.js, offline.html, icons/    the PWA shell. The service worker is
     *                                  fetched and precaches these on install and
     *                                  on every update check; a session that has
     *                                  expired in between would otherwise answer
     *                                  with /login HTML, and the worker would
     *                                  cache that as the offline page. All three
     *                                  are static and contain no ward data.
     */
    '/((?!login|api/auth|_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest|maplibre-gl-|sw.js|offline.html|icons/|floorplan/).*)',
  ],
}
