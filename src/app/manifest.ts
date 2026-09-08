import type { MetadataRoute } from 'next'

/**
 * Makes "Add to Home Screen" produce a standalone app rather than a Safari
 * bookmark. This app is used walking a street with a phone, so the address bar
 * and toolbar are worth reclaiming.
 *
 * Android additionally wants a 192px and a 512px PNG before it will offer to
 * install; iOS ignores this file entirely and reads the apple-touch-icon link
 * in the root layout. Both sets come from `npm run icons`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // A stable id, so a later change of name or start_url updates the installed
    // app instead of installing a second copy beside it.
    id: '/',
    name: 'Ward Map',
    short_name: 'Ward Map',
    description: 'Private ward parcel and household map.',
    // The dashboard, not '/': the public landing page is for visitors, and
    // somebody who installed this did it to open the map on a doorstep. An
    // expired session still lands on /login from here, as it always did.
    start_url: '/dashboard',
    // Everything on this origin belongs to the app, so an in-app link never
    // kicks the user out to a browser tab.
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    dir: 'ltr',
    lang: 'en',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Separate entries, not 'any maskable' on one icon: a launcher that crops
      // a padded icon leaves it visibly small, and one that does not crop a
      // full-bleed icon leaves it visibly square.
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
