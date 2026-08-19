'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

export type NavLink = { href: string; label: string }

/**
 * The header controls every signed-in page carries.
 *
 * One primary button — Dashboard, the way back to the list of everything — plus
 * a menu holding the rest: the other sections this person may open, the admin
 * tools, the password form, and sign out. Links were losing to the buttons
 * beside them at a glance, so everything here is a button-shaped target.
 *
 * The dashboard itself renders only the menu: a Dashboard button on the
 * dashboard points at the page you are already on.
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

  const onDashboard = pathname === '/'
  const items: NavLink[] = [
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
      {!onDashboard && (
        <Link
          href="/"
          className="inline-flex min-h-9 items-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-900 shadow-sm transition hover:border-neutral-900"
        >
          Dashboard
        </Link>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-900 shadow-sm transition hover:border-neutral-900"
      >
        Menu
        <span aria-hidden className={`text-[0.6rem] text-neutral-500 ${open ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-30 mt-1 w-56 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
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
            className="block px-3 py-2.5 text-sm text-neutral-800 hover:bg-neutral-50"
          >
            Change password
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' })
              // A hard navigation, not router.push: it drops every cached
              // server payload the signed-in session rendered.
              location.href = '/login'
            }}
            className="block w-full px-3 py-2.5 text-left text-sm text-neutral-800 hover:bg-neutral-50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
