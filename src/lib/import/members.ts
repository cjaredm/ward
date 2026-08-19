/**
 * Parser for LCR's "Member List" report — the one with a name and a postal
 * address per member.
 *
 * The layout is a two-column table where the right column is two or three lines
 * tall and the name is set against the middle of it:
 *
 *   Alderete, Jordan      1730 S Rio Virgin Dr
 *                         Washington UT 84780-8231
 *   Perkins, Navy J
 *                         1564 South Aspen Way
 *                         Ripple Rd
 *                         Washington UT 84780-2297
 *   Powell, Alexia                                  <- no address on file
 *   Barney, Lydia Rae                               <- page ends here...
 *   ---- page break ----
 *                         1608 S Amity Ln           <- ...address continues here
 *                         Washington UT 84780-8371
 *
 * So address lines cannot be tied to a name by their line alone. What holds is
 * that a block always *ends* with a city/state line, so lines are accumulated
 * onto the member being read until one of those closes the block; anything left
 * over belongs to the name that comes next.
 */
import { splitAt, type Line } from './pdf'

export type MemberRow = {
  /** 'Van Ausdal' */
  last: string
  /** 'Jolene', or 'Kelsee Sarah' */
  first: string
  /** Name as printed: 'Van Ausdal, Jolene' */
  printed: string
  /** Street line(s), without the city/state/zip. */
  street: string | null
  /** 'Washington UT 84780-8231' */
  cityLine: string | null
  city: string | null
  state: string | null
  zip: string | null
  page: number
}

export type MemberParseResult = {
  rows: MemberRow[]
  skipped: { page: number; text: string; why: string }[]
  unitName: string | null
  reportDate: string | null
  /** The 'Count: 558' the report prints at the end, when it prints one. */
  printedCount: number | null
}

/** Every US state and territory LCR might print. A street type is not one of these. */
const STATES = new Set(
  (
    'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM ' +
    'NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR VI GU AS MP'
  ).split(' '),
)

function isFurniture(text: string): boolean {
  return (
    /^Member List/i.test(text) ||
    /^Name\s+Address$/i.test(text) ||
    /For Church Use Only/i.test(text) ||
    /Intellectual Reserve/i.test(text) ||
    /(Ward|Branch|Stake) \(\d+\)/.test(text) ||
    /^Count: \d+$/i.test(text) ||
    /^\d{1,3}$/.test(text)
  )
}

/**
 * True for the last line of an address: '... UT 84780-2382', 'Washington UT'.
 *
 * The state has to be a real two-letter code, and an all-caps street like
 * '1187 E BLACK BRUSH DR' would otherwise end in one — so a line with no zip
 * also has to not start with a house number.
 */
export function isCityLine(text: string): boolean {
  const m = text.match(/(?:^|\s)([A-Z]{2})(?:\s+(\d{5})(?:-(\d{4}))?)?\s*$/)
  if (!m || !STATES.has(m[1])) return false
  return Boolean(m[2]) || !/^\d/.test(text.trim())
}

function parseCityLine(text: string): {
  city: string | null
  state: string | null
  zip: string | null
} {
  const m = text.match(/^(.*?)\s*([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?\s*$/)
  if (!m) return { city: null, state: null, zip: null }
  return { city: m[1].trim() || null, state: m[2], zip: m[3] ?? null }
}

/** 'Van Ausdal, Jolene' → last / first. Returns null when there is no comma. */
function splitName(printed: string): { last: string; first: string } | null {
  const comma = printed.indexOf(',')
  if (comma === -1) return null
  const last = printed.slice(0, comma).trim()
  const first = printed.slice(comma + 1).trim()
  return last && first ? { last, first } : null
}

/**
 * A name, in the left column. Members are printed 'Surname, Given', including
 * the one row in the sample where somebody typed the surname in lower case.
 */
function looksLikeName(text: string): boolean {
  return /^[A-Za-z][A-Za-z'’.\- ]*,\s*\S/.test(text)
}

type Draft = { row: MemberRow; lines: string[] }

export function parseMemberReport(lines: Line[]): MemberParseResult {
  const drafts: Draft[] = []
  const skipped: MemberParseResult['skipped'] = []
  let unitName: string | null = null
  let reportDate: string | null = null
  let printedCount: number | null = null

  let boundary: number | null = null
  let current: Draft | null = null
  /** Address lines printed above the name they belong to. */
  let pending: string[] = []

  const complete = (d: Draft | null) =>
    Boolean(d && d.lines.length > 0 && isCityLine(d.lines[d.lines.length - 1]))

  for (const line of lines) {
    const text = line.text
    if (!text) continue

    // The column header is also where the split point comes from.
    const addressRun = line.runs.find((r) => /^Address$/i.test(r.text))
    if (addressRun && line.runs.some((r) => /^Name$/i.test(r.text))) {
      boundary = addressRun.x - 6
      continue
    }

    if (unitName === null) {
      const m = text
        .replace(/Member List/i, '')
        .trim()
        .match(/^(.+?\(\d{4,}\))/)
      if (m) unitName = m[1].trim()
    }
    if (reportDate === null) {
      const m = text.match(/^(\d{1,2} [A-Z][a-z]{2} \d{4})/)
      if (m) reportDate = m[1]
    }
    const count = text.match(/^Count: (\d+)$/i)
    if (count) printedCount = Number(count[1])

    if (isFurniture(text)) continue

    const split = boundary === null ? null : splitAt(line, boundary)
    // Without a column boundary, the address is whatever starts at the house
    // number: 'Alderete, Jordan 1730 S Rio Virgin Dr'. A PO box has no house
    // number, so it is named explicitly.
    const fallback = text.match(/^(.*?,\s*[^,\d]+?)\s+((?:\d|P\.?\s?O\.?\s+Box).*)$/i)
    const nameText = split ? split.left : (fallback?.[1] ?? (looksLikeName(text) ? text : ''))
    const addrText = split ? split.right : (fallback?.[2] ?? (looksLikeName(text) ? '' : text))

    if (nameText) {
      const name = splitName(nameText)
      if (!name) {
        skipped.push({ page: line.page, text, why: 'could not read a name' })
      } else {
        current = {
          row: {
            last: name.last,
            first: name.first,
            printed: nameText.trim(),
            street: null,
            cityLine: null,
            city: null,
            state: null,
            zip: null,
            page: line.page,
          },
          // Lines printed above a name belong to it: the name is set against the
          // middle of a three-line address.
          lines: [...pending],
        }
        pending = []
        drafts.push(current)
      }
    }

    if (addrText) {
      if (current && !complete(current)) current.lines.push(addrText)
      else pending.push(addrText)
    }
  }

  for (const p of pending) {
    skipped.push({ page: 0, text: p, why: 'address with no member to attach it to' })
  }

  const rows = drafts.map(({ row, lines: addr }) => {
    const last = addr[addr.length - 1]
    if (last && isCityLine(last)) {
      row.cityLine = last
      Object.assign(row, parseCityLine(last))
      row.street = addr.slice(0, -1).join(', ') || null
    } else if (addr.length > 0) {
      // No city line: an address the clerk left half-typed. Keep what there is.
      row.street = addr.join(', ')
    }
    return row
  })

  return { rows, skipped, unitName, reportDate, printedCount }
}
