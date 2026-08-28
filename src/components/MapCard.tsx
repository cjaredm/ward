'use client'

import { useEffect, useState } from 'react'

/**
 * One of the floating cards on the building map, with a header that folds it
 * away.
 *
 * The cards are over the drawing, not beside it — there is nowhere beside it on
 * a phone — so every row they hold is a row of the building somebody cannot see.
 * Folded, a card is its own title bar and nothing else.
 *
 * Open by default on a screen with the height for it, folded on one without.
 * Deliberately not remembered between visits: the map is opened to answer a
 * question, and a card somebody folded three Sundays ago is a control that has
 * gone missing.
 */
export default function MapCard({
  title,
  action,
  children,
  className = '',
  openClassName = '',
}: {
  title: string
  /** A control that belongs in the header. Hidden when the card is folded. */
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  /**
   * Classes that apply only while open. For a card that is a button when folded
   * and a panel when not: the Key is 80px of "KEY" most of the time, and there
   * is no reason for it to reserve the width of the list it is hiding.
   */
  openClassName?: string
}) {
  const [open, setOpen] = useState(true)
  /** Null until measured, so the first paint is not the wrong state. */
  const [roomy, setRoomy] = useState<boolean | null>(null)

  useEffect(() => {
    // A phone held sideways has about 300px of height for the whole page, which
    // is not enough for a card and a floorplan both.
    const mq = window.matchMedia('(min-height: 601px)')
    const sync = () => {
      setRoomy(mq.matches)
      setOpen(mq.matches)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const shown = roomy === null ? true : open

  return (
    <div
      className={`relative flex min-h-0 flex-col rounded-lg border border-neutral-200 bg-white/95 shadow-sm backdrop-blur-[2px] ${className} ${
        shown ? openClassName : ''
      }`}
    >
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={shown}
          className="flex min-h-11 flex-1 items-center gap-1.5 rounded-lg px-2 text-left whitespace-nowrap sm:min-h-9"
        >
          <Chevron open={shown} />
          <span className="text-[11px] font-medium tracking-[0.08em] text-neutral-500 uppercase">
            {title}
          </span>
        </button>
        {shown && action && <div className="shrink-0 pr-1.5">{action}</div>}
      </div>

      {shown && (
        <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-2">{children}</div>
      )}
    </div>
  )
}

/** The fold indicator: pointing down when open, right when closed. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform ${
        open ? '' : '-rotate-90'
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  )
}
