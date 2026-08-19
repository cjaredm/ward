import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_NAME, verifySession } from '@/lib/auth-edge'

/**
 * Runs on the Edge runtime, so it only verifies the JWT (jose is Edge-safe).
 * The bcrypt comparison lives in the Node.js login route.
 */
export async function middleware(req: NextRequest) {
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
     *   sw.js, offline.html, icons/    the PWA shell. The service worker is
     *                                  fetched and precaches these on install and
     *                                  on every update check; a session that has
     *                                  expired in between would otherwise answer
     *                                  with /login HTML, and the worker would
     *                                  cache that as the offline page. All three
     *                                  are static and contain no ward data.
     */
    '/((?!login|api/auth|_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest|maplibre-gl-|sw.js|offline.html|icons/).*)',
  ],
}
