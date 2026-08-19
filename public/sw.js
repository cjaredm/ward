/*
 * Service worker for Ward Map.
 *
 * WHAT IT CACHES: the app shell only — hashed /_next/static bundles, the
 * vendored maplibre worker, the icons, the manifest, and an offline page.
 *
 * WHAT IT MUST NEVER CACHE: anything under /api/, and any HTML document. This
 * app holds names, home addresses and phone numbers of ward members including
 * minors, and Cache Storage outlives the session cookie — a cached page or API
 * response would keep that data readable on the device after sign-out. Every
 * such request goes straight to the network here, and TopNav drops these caches
 * on sign-out as a second line.
 *
 * Bump VERSION to evict every previously cached asset on the next activate.
 */
const VERSION = 'v1'
const CACHE = `ward-shell-${VERSION}`
const OFFLINE_URL = '/offline.html'

// Precached so the offline fallback is available on the very first flight loss,
// including one that happens before any navigation has been served.
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png', '/manifest.webmanifest']

/** Path prefixes safe to keep: immutable, or public, and never member data. */
function isShellAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/maplibre-gl-') ||
    url.pathname === '/favicon.ico' ||
    url.pathname === '/manifest.webmanifest'
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // Individually, not addAll: one 404 in the list would otherwise reject the
      // whole install and leave the worker permanently stuck.
      await Promise.all(
        PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})),
      )
      // Only the shell is cached, so there is no half-migrated state to wait
      // out — taking over immediately means the offline page works this visit.
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  // Sent by TopNav on sign-out. The shell holds no member data, but a shared
  // phone should not carry the previous person's app state either.
  if (event.data === 'clear-caches') {
    event.waitUntil(caches.keys().then((ns) => Promise.all(ns.map((n) => caches.delete(n)))))
  }
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Pages: always the network, so a signed-out or expired session gets the real
  // redirect to /login rather than a cached page for someone else. On a genuine
  // network failure — not a 401 — the offline page stands in.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL)
        return cached ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
      }),
    )
    return
  }

  if (!isShellAsset(url)) return // /api/* and everything else: untouched.

  // Cache-first. /_next/static filenames carry a build hash, so a hit is never
  // stale; the others are refreshed in the background after being served.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(request)
      if (hit) {
        if (!url.pathname.startsWith('/_next/static/')) {
          event.waitUntil(
            fetch(request)
              .then((res) => (res.ok && res.type === 'basic' ? cache.put(request, res) : undefined))
              .catch(() => {}),
          )
        }
        return hit
      }
      const res = await fetch(request)
      // Only own-origin 200s: an opaque or redirected response cached here would
      // be replayed as the asset itself.
      if (res.ok && res.type === 'basic') event.waitUntil(cache.put(request, res.clone()))
      return res
    })(),
  )
})
