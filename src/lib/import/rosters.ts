/**
 * Parser for the members variant of LCR's "Organizations and Callings" report.
 *
 * Same report name as the callings one, different content: instead of a calling
 * per row it prints a roster per organization and per class, names only.
 *
 *   Elders Quorum                  <- section heading, maps to an org
 *     Elders Quorum Members        <- roster heading, maps to (org, unit)
 *       Name                       <- column header, repeats on every page
 *       Alderete, Jordan
 *       ...
 *     Count: 180
 *   Young Women
 *     Gatherers of Light Members
 *       Name
 *       Clark, Alice
 *       ** Wright, Callie Mae      <- flagged in a left gutter
 *     ** Unbaptized members of record age 9 and over ...   <- what ** means
 *     Count: 9
 *
 * One column, so unlike the callings report there is no boundary to split on:
 * every content line is either furniture, a heading, a footnote or a name.
 *
 * The flags are kept rather than stripped and forgotten. '**' is a member of
 * record who is not counted in unit statistics, and '*' is somebody assigned
 * outside their default class — both are things a bishopric asks about, and both
 * are invisible once the leading characters are gone.
 */
import { orgForHeading, rosterTarget, type OrgKey } from '../orgs'
import type { Line } from './pdf'

export type RosterRow = {
  /** The org the roster belongs to. */
  org: OrgKey
  /** The class inside it, or '' when the roster is the organization itself. */
  unit: string
  /** Roster heading as printed, without the trailing 'Members'. */
  roster: string
  /** 'Van Ausdal' — everything before the comma. */
  last: string
  /** 'Jolene', or 'Kelsee Sarah'. */
  first: string
  /** Name column exactly as printed, flags removed. */
  printed: string
  /** '*': assigned outside the default class for their age. */
  outOfDefaultClass: boolean
  /** '**': member of record not counted in unit statistics. */
  notCounted: boolean
  /** Report order within the roster. */
  sort: number
  page: number
}

export type RosterParseResult = {
  rows: RosterRow[]
  /**
   * One entry per roster the report printed, in report order, including any that
   * came out empty. This is the set a re-import is authoritative over, so it has
   * to survive even when nothing under the heading could be read.
   */
  rosters: { org: OrgKey; unit: string; label: string; printedCount: number | null; rows: number }[]
  skipped: { page: number; text: string; why: string }[]
  unitName: string | null
  reportDate: string | null
}

/** Header/footer furniture that repeats on every page. */
function isFurniture(text: string): boolean {
  return (
    /^Organizations and Callings/i.test(text) ||
    /^Name$/i.test(text) ||
    /For Church Use Only/i.test(text) ||
    /Intellectual Reserve/i.test(text) ||
    /(Ward|Branch|Stake) \(\d+\)/.test(text) ||
    /^\d{1,3}$/.test(text)
  )
}

/**
 * The gutter flags in front of a name, and what is left of the line.
 *
 * They arrive as their own runs — '*', '**', or '*' then '**' on the one row
 * that is both — so they are read off the front as tokens rather than counted.
 */
function readFlags(text: string): { rest: string; star: boolean; doubleStar: boolean } {
  let rest = text
  let star = false
  let doubleStar = false
  for (;;) {
    const m = rest.match(/^(\*{1,2})(?:\s+|$)/)
    if (!m) break
    if (m[1] === '*') star = true
    else doubleStar = true
    rest = rest.slice(m[0].length)
  }
  return { rest: rest.trim(), star, doubleStar }
}

/**
 * A name, as this report prints them: 'Surname, Given'. Includes the rows where
 * somebody typed the surname in lower case ('provost, William Harris').
 */
function looksLikeName(text: string): boolean {
  return /^[A-Za-z][A-Za-z'’.\- ]*,\s*\S/.test(text)
}

/** 'Van Ausdal, Jolene' → last / first. Null when there is no usable comma. */
function splitName(printed: string): { last: string; first: string } | null {
  const comma = printed.indexOf(',')
  if (comma === -1) return null
  const last = printed.slice(0, comma).trim()
  const first = printed.slice(comma + 1).trim()
  return last && first ? { last, first } : null
}

export function parseRosterReport(lines: Line[]): RosterParseResult {
  const rows: RosterRow[] = []
  const rosters: RosterParseResult['rosters'] = []
  const skipped: RosterParseResult['skipped'] = []
  let unitName: string | null = null
  let reportDate: string | null = null

  let section: OrgKey | null = null
  let current: RosterParseResult['rosters'][number] | null = null
  let sort = 0

  for (const line of lines) {
    const text = line.text
    if (!text) continue

    if (unitName === null) {
      const m = text
        .replace(/Organizations and Callings/i, '')
        .trim()
        .match(/^(.+?\(\d{4,}\))/)
      if (m) unitName = m[1].trim()
    }
    if (reportDate === null) {
      const m = text.match(/^(\d{1,2} [A-Z][a-z]{2} \d{4})/)
      if (m) reportDate = m[1]
    }

    // 'Count: 180' closes the roster it is printed under. Recorded on the roster
    // so a parse that loses rows can be told from a roster that is genuinely
    // small: the report says how many it printed.
    const count = text.match(/^Count: (\d+)$/i)
    if (count) {
      if (current) current.printedCount = Number(count[1])
      continue
    }

    if (isFurniture(text)) continue

    // A roster heading. Tested before the section headings because 'Elders
    // Quorum Members' would otherwise be read as the Elders Quorum section.
    if (/\sMembers$/i.test(text)) {
      if (!section) {
        skipped.push({ page: line.page, text, why: 'roster with no organization heading above it' })
        current = null
        continue
      }
      const target = rosterTarget(section, text)
      current = {
        org: target.org,
        unit: target.unit,
        label: text.trim().replace(/\s+Members$/i, '').trim(),
        printedCount: null,
        rows: 0,
      }
      rosters.push(current)
      sort = 0
      continue
    }

    const heading = orgForHeading(text)
    if (heading) {
      section = heading
      // Not cleared: the section heading and its first roster heading are two
      // lines, and nothing can be attributed between them anyway.
      current = null
      continue
    }

    const { rest, star, doubleStar } = readFlags(text)
    if (!rest) continue

    // The footnotes explaining the flags are the only other flagged lines, and
    // neither is a 'Surname, Given'.
    if (!looksLikeName(rest)) {
      if (!/^(out of default class|unbaptized members)/i.test(rest)) {
        skipped.push({ page: line.page, text, why: 'not a name and not a heading' })
      }
      continue
    }

    if (!current) {
      skipped.push({ page: line.page, text, why: 'name with no roster heading above it' })
      continue
    }

    const name = splitName(rest)
    if (!name) {
      skipped.push({ page: line.page, text, why: 'could not read a name' })
      continue
    }

    current.rows++
    rows.push({
      org: current.org,
      unit: current.unit,
      roster: current.label,
      last: name.last,
      first: name.first,
      printed: rest,
      outOfDefaultClass: star,
      notCounted: doubleStar,
      sort: sort++,
      page: line.page,
    })
  }

  return { rows, rosters, skipped, unitName, reportDate }
}
