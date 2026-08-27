'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * One line of text that gets a tooltip only when it does not fit.
 *
 * A `title` on every line would mean hovering a name that is perfectly readable
 * pops a box repeating it back. So the element measures itself instead —
 * scrollWidth past clientWidth is exactly "this is being ellipsised" — and
 * re-measures on resize, because the legend card is a fraction of the viewport
 * and the same name clips on a phone and does not on a laptop.
 */
export default function Clamped({
  children,
  className,
  style,
}: {
  children: string
  className?: string
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [clipped, setClipped] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // A pixel of tolerance: sub-pixel text widths otherwise report every line as
    // overflowing by a fraction and every line gets a tooltip after all.
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [children])
  return (
    <span
      ref={ref}
      className={`block truncate ${className ?? ''}`}
      style={style}
      // Undefined, not '': an empty title still renders an empty tooltip box.
      title={clipped ? children : undefined}
    >
      {children}
    </span>
  )
}
