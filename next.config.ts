import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * `next build` and `next dev` both write to .next, and a build run while a dev
   * server is up leaves that directory half production / half dev with no
   * BUILD_ID — the dev server then 500s on every page until it is restarted and
   * .next is cleared.
   *
   * Set NEXT_DIST_DIR to build somewhere else:
   *   NEXT_DIST_DIR=.next-verify npm run build
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',

  async headers() {
    return [
      {
        // This app holds names, home addresses and phone numbers of church
        // members including minors. It must never be indexed.
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

export default nextConfig
