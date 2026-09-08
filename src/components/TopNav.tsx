'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

export type NavLink = { href: string; label: string }

/**
 * The one control every signed-in page carries: Menu.
 *
 * Dashboard used to sit outside as a second button. It is inside now, at the top
 * of the list, because two controls is two controls to fit on every page — and
 * the building map wants that width for the drawing, not for a button that
 * duplicates the first line of the menu it sits next to.
 *
 * The menu hangs from the right edge and is scrollable. Both are load-bearing on
 * a phone: a panel anchored left runs off the screen when the button is near the
 * right edge, and a ward with every section granted plus the admin pages is
 * taller than a phone held sideways.
 */
export default function TopNav({ links, isAdmin }: { links: NavLink[]; isAdmin: boolean }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  // A menu that stays open after a click elsewhere reads as stuck. Escape and
  // an outside pointer both close it; the links close it by navigating.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const items: NavLink[] = [
    // First, and only when it is somewhere else: a Dashboard item on the
    // dashboard points at the page you are already on.
    ...(pathname === '/dashboard' ? [] : [{ href: '/dashboard', label: 'Dashboard' }]),
    ...links.filter((l) => l.href !== pathname),
    ...(isAdmin
      ? [
          { href: '/admin/users', label: 'People & access' },
          { href: '/admin/import', label: 'Import from LCR' },
        ].filter((l) => l.href !== pathname)
      : []),
  ]

  return (
    <div ref={wrap} className="relative flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-900 shadow-sm transition hover:border-neutral-900 sm:min-h-9"
      >
        Menu
        <span aria-hidden className={`text-[0.6rem] text-neutral-500 ${open ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {open && (
        <div
          role="menu"
          // Right-anchored, never wider than the viewport, and scrolling inside
          // itself rather than off the bottom of the screen. `overscroll-contain`
          // stops a flick at the end of the list panning the map underneath.
          className="absolute top-full right-0 z-30 mt-1 max-h-[70dvh] w-56 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
        >
          {items.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-3 py-2.5 text-sm text-neutral-800 hover:bg-neutral-50"
            >
              {l.label}
            </Link>
          ))}

          {items.length > 0 && <div className="my-1 border-t border-neutral-200" />}

          <Link
            href="/change-password"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center px-3 text-sm text-neutral-800 hover:bg-neutral-50"
          >
            Change password
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' })
              // The service worker caches the app shell only, never a page or an
              // API response — but this is a phone that gets handed around, so
              // sign-out empties Cache Storage rather than trusting that rule to
              // hold for every asset added later.
              navigator.serviceWorker?.controller?.postMessage('clear-caches')
              // A hard navigation, not router.push: it drops every cached
              // server payload the signed-in session rendered.
              location.href = '/login'
            }}
            className="flex min-h-11 w-full items-center px-3 text-left text-sm text-neutral-800 hover:bg-neutral-50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
