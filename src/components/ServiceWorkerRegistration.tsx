'use client'

import { useEffect } from 'react'

/**
 * Registers public/sw.js, which is what turns the manifest into an installable
 * app rather than a bookmark: Chrome requires a service worker with a fetch
 * handler before it will offer to install.
 *
 * Production only. In dev the worker would cache /_next/static across restarts,
 * and those filenames are not content-hashed there — the result is a page built
 * from a mix of two compilations. Any worker left over from a production build
 * on the same origin (localhost) is unregistered instead.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()))
      return
    }

    // After load, not during it: registration competes with the first paint's
    // requests otherwise, and this page is opened on a phone on cell data.
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // A failed registration costs the install prompt and the offline page,
        // nothing else. The app itself does not depend on the worker.
      })
    }

    if (document.readyState === 'complete') register()
    else {
      window.addEventListener('load', register)
      return () => window.removeEventListener('load', register)
    }
  }, [])

  return null
}
