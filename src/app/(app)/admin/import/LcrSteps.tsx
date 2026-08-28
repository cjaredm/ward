/**
 * The "where in LCR does this come from" block that sits above each upload.
 *
 * Every importer wants the same three things said — the page to open, what to
 * set before printing, and what the resulting PDF has to look like — so they are
 * said the same way in all three.
 */
import type { ReactNode } from 'react'

export default function LcrSteps({
  href,
  linkLabel,
  steps,
  columns,
}: {
  /** Deep link to the LCR page the report is printed from. */
  href: string
  /** What that page is called in LCR. */
  linkLabel: string
  /** What to set on it, in order, before printing. */
  steps: ReactNode[]
  /** The column header the parser splits on, so a wrong export is obvious here. */
  columns: string
}) {
  return (
    <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
      >
        {linkLabel} ↗
      </a>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-neutral-600">
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-neutral-500">
        The PDF should come out with these columns: <span className="font-medium">{columns}</span>.
      </p>
    </div>
  )
}
