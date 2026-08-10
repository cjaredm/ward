import type { MetadataRoute } from 'next'

/**
 * Makes "Add to Home Screen" produce a standalone app rather than a Safari
 * bookmark. This app is used walking a street with a phone, so the address bar
 * and toolbar are worth reclaiming.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Ward Map',
    short_name: 'Ward Map',
    description: 'Private ward parcel and household map.',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [{ src: '/favicon.ico', sizes: 'any', type: 'image/x-icon' }],
  }
}
