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
  onClick,
}: {
  label: string
  hint: string
  icon: React.ReactNode
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
    <div className="group relative flex-1">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={pressed}
        aria-label={`${label}. ${hint}`}
        // Native tooltip as well: it survives a long hover without the card
        // having to stay open, and costs nothing.
        title={`${label} — ${hint}`}
        className={`flex min-h-11 w-full items-center justify-center rounded-md sm:min-h-9 ${
          pressed
            ? 'bg-blue-600 text-white'
            : 'border border-neutral-300 text-neutral-700 hover:bg-neutral-100'
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
