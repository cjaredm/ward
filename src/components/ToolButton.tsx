'use client'

/**
 * One map tool, as an icon.
 *
 * The label is not decoration that got dropped — it is the accessible name and
 * the tooltip, so the button is still legible to a screen reader and to anyone
 * who cannot guess a pictogram. The tooltip opens on focus as well as hover,
 * which is what makes it reachable by keyboard and by a first tap on a phone,
 * where hover does not exist.
 */
export default function ToolButton({
  label,
  hint,
  icon,
  align,
  pressed = false,
  segment = false,
  onClick,
}: {
  label: string
  hint: string
  icon: React.ReactNode
  /**
   * One cell of a segmented control rather than a button of its own.
   *
   * The border and the rounding come from the group instead, which is what makes
   * a row of these exactly as tall as a card with a single 44px control in it —
   * the building map's top bar puts the two side by side, and 2px of padding
   * between them reads as a mistake.
   */
  segment?: boolean
  /**
   * Which edge the tooltip hangs from. The card is barely wider than three
   * tooltips, so a centred one under the first or last button runs off the side
   * of a phone.
   */
  align: 'left' | 'center' | 'right'
  pressed?: boolean
  onClick: () => void
}) {
  const anchor = {
    left: 'left-0',
    center: 'left-1/2 -translate-x-1/2',
    right: 'right-0',
  }[align]
  return (
    // min-w-11 as well as flex-1: in the top bar the row is sized by its
    // contents rather than stretched across a card, and an icon button that is
    // only as wide as its icon is not a 44px target.
    <div className="group relative min-w-11 flex-1">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={pressed}
        aria-label={`${label}. ${hint}`}
        // Native tooltip as well: it survives a long hover without the card
        // having to stay open, and costs nothing.
        title={`${label} — ${hint}`}
        className={`flex min-h-11 w-full items-center justify-center sm:min-h-9 ${
          segment ? 'h-full' : 'rounded-md'
        } ${
          pressed
            ? 'bg-blue-600 text-white'
            : `text-neutral-700 hover:bg-neutral-100 ${segment ? '' : 'border border-neutral-300'}`
        }`}
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icon}
        </svg>
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-30 mt-1 hidden w-44 rounded-md bg-neutral-900 px-2 py-1.5 text-[11px] leading-snug text-white shadow-lg group-hover:block group-focus-within:block ${anchor}`}
      >
        <span className="font-medium">{label}</span>
        <span className="text-neutral-300"> — {hint}</span>
      </span>
    </div>
  )
}
