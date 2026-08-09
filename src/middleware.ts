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
     *   /login, /api/auth/* (the way in)
     *   _next/*, favicon, robots (static)
     */
    '/((?!login|api/auth|_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
}
