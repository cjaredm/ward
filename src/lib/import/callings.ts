/**
 * Parser for LCR's "Organizations and Callings" report.
 *
 * The report is a stack of sections, each a two-column table:
 *
 *   Elders Quorum                    <- section heading, maps to an org
 *     Elders Quorum Presidency       <- sub-heading, kept as the calling's unit
 *       Calling                Name  <- column header, gives us the split point
 *       Elders Quorum President  Barlow, Taylor
 *       Elders Quorum Assistant Secretary   Calling Vacant
 *     Count: 5
 *   * custom calling                 <- footnote for the '*' rows above
 *
 * Vacancies are kept. 'Calling Vacant' rows are the most useful lines on the
 * page for a bishopric, so they become calling rows with no person attached.
 */
import { refineOrg, orgForHeading, type OrgKey } from '../orgs'
import { splitAt, type Line } from './pdf'

export type CallingRow = {
  /** The org the calling belongs to, refined by sub-heading where it says so. */
  org: OrgKey
  /** The section it was printed under, before refinement. */
  section: OrgKey
  /** Sub-heading it was printed under: 'Valiant 9', 'Ministering', 'Course 15'. */
  unit: string | null
  /** Calling name, with LCR's leading '*' stripped. */
  calling: string
  /** True for the '*' rows: a calling this ward created rather than a standard one. */
  isCustom: boolean
  vacant: boolean
  /** 'Van Ausdal' — everything before the comma in the name column. */
  last: string | null
  /** 'Jolene', or 'Kelsee Sarah'. Everything after the comma. */
  first: string | null
  /** The name column exactly as printed. */
  printed: string
  /** Report order. Keeps a presidency listed as a presidency. */
  sort: number
  page: number
}

export type ParseResult = {
  rows: CallingRow[]
  /** Lines that looked like table rows but could not be read. Surfaced in the UI. */
  skipped: { page: number; text: string; why: string }[]
  /** Unit name printed in the report header, e.g. 'Scenic Sunrise Ward (2241102)'. */
  unitName: string | null
  /** Date printed in the footer, as printed. */
  reportDate: string | null
}

/** Header/footer furniture that repeats on every page. */
function isFurniture(text: string): boolean {
  return (
    /^Organizations and Callings/i.test(text) ||
    /For Church Use Only/i.test(text) ||
    /Intellectual Reserve/i.test(text) ||
    /(Ward|Branch|Stake) \(\d+\)/.test(text) ||
    /^Count: \d+$/i.test(text) ||
    /^\*\s*custom calling$/i.test(text) ||
    /^Calling\s+Name$/i.test(text) ||
    /^\d{1,3}$/.test(text) // bare page number
  )
}

/**
 * Surname particles. Needed only by the text-only fallback below: when the
 * column boundary is unknown, 'Relief Society Ministering Secretary Van Ausdal,
 * Jolene' has to be cut before 'Van', not before 'Ausdal,'.
 */
const PARTICLES = new Set([
  'VAN', 'VON', 'DE', 'DEL', 'DELA', 'DER', 'DI', 'DU', 'LA', 'LE', 'MC', 'MAC', 'ST', 'SAINT', 'O',
])

const VACANT = /calling vacant$/i

/**
 * 'Lastname, Firstname' anywhere in a line. Used only by the text-only fallback,
 * to tell a table row from a heading. The comma has to follow a letter: the
 * Primary class heading 'CTR 5, CTR 6' is a heading, not somebody called CTR.
 */
const NAME_IN_TEXT = /[A-Za-z]['\u2019]?,\s+[A-Z]/

/**
 * Splits a row that arrived as one string, with no column geometry to cut on.
 *
 * Only reached when a page has no readable 'Calling / Name' header — the
 * positioned path is what normally runs.
 */
export function splitMergedRow(text: string): { calling: string; printed: string } | null {
  if (VACANT.test(text)) {
    return { calling: text.replace(VACANT, '').trim(), printed: 'Calling Vacant' }
  }

  const tokens = text.split(' ')
  const commaAt = tokens.findIndex((t) => t.endsWith(','))
  if (commaAt < 1) return null

  // Walk back over particles so a two-word surname stays with the name.
  let start = commaAt
  while (start > 1 && PARTICLES.has(tokens[start - 1].toUpperCase().replace(/\./g, ''))) start--

  const calling = tokens.slice(0, start).join(' ').trim()
  const printed = tokens.slice(start).join(' ').trim()
  return calling && printed ? { calling, printed } : null
}

/** 'Van Ausdal, Jolene' → last / first. */
function splitName(printed: string): { last: string | null; first: string | null } {
  const comma = printed.indexOf(',')
  if (comma === -1) return { last: printed.trim() || null, first: null }
  return {
    last: printed.slice(0, comma).trim() || null,
    first: printed.slice(comma + 1).trim() || null,
  }
}

/**
 * The bishopric is printed twice: once as its own section and again as the
 * 'Presidency of the Aaronic Priesthood'. The second listing is the same three
 * men in the same three callings, so it is dropped rather than imported as a
 * second Bishop.
 */
const RESTATED_SUBHEADINGS = [/^presidency of the aaronic priesthood$/i]

export function parseCallingsReport(lines: Line[]): ParseResult {
  const rows: CallingRow[] = []
  const skipped: ParseResult['skipped'] = []
  let unitName: string | null = null
  let reportDate: string | null = null

  let section: OrgKey | null = null
  let unit: string | null = null
  let sort = 0

  // Column boundary, learned from each page's 'Calling / Name' header and reused
  // for the rest of that page. Carried across pages because a page whose header
  // is missing still has the same layout as the one before it.
  let boundary: number | null = null

  for (const line of lines) {
    const text = line.text
    if (!text) continue

    if (unitName === null) {
      // The page header prints the report title and the unit on one line:
      // 'Organizations and Callings Scenic Sunrise Ward (2241102)'. Drop the
      // title, keep what is left in front of the unit number.
      const m = text.replace(/Organizations and Callings/i, '').trim().match(/^(.+?\(\d{4,}\))/)
      if (m) unitName = m[1].trim()
    }
    if (reportDate === null) {
      const m = text.match(/^(\d{1,2} [A-Z][a-z]{2} \d{4})/)
      if (m) reportDate = m[1]
    }

    // The column header, which is also how the split point is found.
    const nameRun = line.runs.find((r) => /^Name$/i.test(r.text))
    if (nameRun && line.runs.some((r) => /^Calling$/i.test(r.text))) {
      // A few points to the left of 'Name', so a cell that starts a hair early
      // still lands on the right side.
      boundary = nameRun.x - 6
      continue
    }

    if (isFurniture(text)) continue

    // A heading has nothing in the name column.
    const split = boundary === null ? null : splitAt(line, boundary)

    const looksLikeHeading = split
      ? !split.right
      : !NAME_IN_TEXT.test(text) && !VACANT.test(text)
    if (looksLikeHeading) {
      const heading = (split?.left ?? text).trim()
      const asOrg = orgForHeading(heading)
      if (asOrg) {
        section = asOrg
        unit = null
      } else if (section) {
        unit = heading
      }
      continue
    }

    if (!section) {
      skipped.push({ page: line.page, text, why: 'row before any section heading' })
      continue
    }
    if (RESTATED_SUBHEADINGS.some((re) => unit && re.test(unit))) continue

    let calling = split?.left ?? ''
    let printed = split?.right ?? ''
    if (!calling || !printed) {
      const merged = splitMergedRow(text)
      if (!merged) {
        skipped.push({ page: line.page, text, why: 'could not separate calling from name' })
        continue
      }
      calling = merged.calling
      printed = merged.printed
    }

    const isCustom = calling.startsWith('*')
    calling = calling.replace(/^\*\s*/, '').trim()
    const vacant = VACANT.test(printed)
    const { last, first } = vacant ? { last: null, first: null } : splitName(printed)

    if (!calling) {
      skipped.push({ page: line.page, text, why: 'no calling name' })
      continue
    }

    rows.push({
      org: refineOrg(section, unit),
      section,
      unit,
      calling,
      isCustom,
      vacant,
      last,
      first,
      printed,
      sort: sort++,
      page: line.page,
    })
  }

  return { rows, skipped, unitName, reportDate }
}
