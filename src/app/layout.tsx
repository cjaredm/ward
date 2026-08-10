import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Ward Map',
  description: 'Private ward parcel and household map.',
  robots: { index: false, follow: false },
  // Added to the home screen it runs without Safari's chrome, which is most of
  // the screen back on a phone.
  appleWebApp: { capable: true, title: 'Ward Map', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The map owns zooming; page pinch-zoom only ever fights it. This also stops
  // iOS auto-zooming when a sub-16px input takes focus.
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#ffffff',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} antialiased`}>{children}</body>
    </html>
  )
}
