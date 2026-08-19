/**
 * Text extraction for the PDFs the ward gets out of LCR.
 *
 * Both reports are two-column tables — a label on the left, a name on the right —
 * and the column boundary is the only reliable separator. 'Relief Society
 * Ministering Secretary' followed by 'Van Ausdal, Jolene' has no punctuation
 * between the two halves, and every regex that guesses where one ends is wrong
 * on somebody's surname. So the x coordinate of each text run is kept, and the
 * parsers split on geometry.
 *
 * `unpdf` is a serverless build of pdf.js: no native binaries, no worker, works
 * inside a Vercel function.
 */
import { getDocumentProxy } from 'unpdf'

export type Run = {
  /** Text of one run as pdf.js emitted it. */
  text: string
  /** Left edge, in PDF points from the left of the page. */
  x: number
  /** Right edge. */
  right: number
}

export type Line = {
  page: number
  /** Baseline, in PDF points from the bottom. Only used for ordering. */
  y: number
  runs: Run[]
  /** Every run joined with single spaces — what a text-only extractor would give. */
  text: string
  /** Page width in points, so callers can reason in fractions rather than points. */
  pageWidth: number
}

/** Runs whose baselines are within this many points are the same table row. */
const LINE_TOLERANCE = 2.5

/**
 * Extracts every page as lines of positioned runs, in reading order.
 *
 * Empty runs are dropped: pdf.js emits a lot of them and they would otherwise
 * widen the apparent extent of a column.
 */
export async function extractLines(data: Uint8Array): Promise<Line[]> {
  const pdf = await getDocumentProxy(data)
  const lines: Line[] = []

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const pageWidth = page.view[2] - page.view[0]
    const content = await page.getTextContent()

    // Bucket runs by baseline. A row's runs share a y to within a rounding error,
    // but not exactly, hence the tolerance rather than a Map keyed on y.
    const buckets: { y: number; runs: Run[] }[] = []

    for (const item of content.items) {
      if (!('str' in item)) continue // marked-content markers, not text
      const text = item.str.replace(/\s+/g, ' ').trim()
      if (!text) continue
      const x = item.transform[4] as number
      const y = item.transform[5] as number
      const run: Run = { text, x, right: x + (item.width ?? 0) }

      const bucket = buckets.find((b) => Math.abs(b.y - y) <= LINE_TOLERANCE)
      if (bucket) bucket.runs.push(run)
      else buckets.push({ y, runs: [run] })
    }

    // Top of the page first (PDF y grows upward), left to right within a row.
    buckets.sort((a, b) => b.y - a.y)
    for (const b of buckets) {
      b.runs.sort((p, q) => p.x - q.x)
      lines.push({
        page: n,
        y: b.y,
        runs: b.runs,
        text: b.runs.map((r) => r.text).join(' ').replace(/\s+/g, ' ').trim(),
        pageWidth,
      })
    }
  }

  return lines
}

/**
 * Splits a row at a column boundary.
 *
 * A run that straddles the boundary is put on the side it starts on: pdf.js
 * emits a whole cell as one run far more often than it splits one, and a cell
 * starts where its column starts.
 */
export function splitAt(line: Line, boundary: number): { left: string; right: string } {
  const left: string[] = []
  const right: string[] = []
  for (const run of line.runs) (run.x < boundary ? left : right).push(run.text)
  return { left: left.join(' ').trim(), right: right.join(' ').trim() }
}

/** Turns lines back into plain text, one line per row — for debugging and fixtures. */
export function linesToText(lines: Line[]): string {
  return lines.map((l) => l.text).join('\n')
}
