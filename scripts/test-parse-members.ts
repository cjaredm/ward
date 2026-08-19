/**
 * Exercises the member-list parser on both paths a real upload can take.
 *
 * The fixture is laid out as an actual two-column PDF, with the name set against
 * the middle of its address block and one member deliberately cut in half by a
 * page break — the two things that make this report awkward to read. It is then
 * fed in again as plain text, with no column geometry, to cover the fallback.
 *
 * Reads nothing from the database.
 *
 *   npx tsx scripts/test-parse-members.ts [file.txt]
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseMemberReport, type MemberParseResult } from '../src/lib/import/members'
import { extractLines, type Line } from '../src/lib/import/pdf'
import { makePdf, type PdfRun } from './lib/mini-pdf'
import { run } from './lib/run'

const PAGE_WIDTH = 918
const NAME_X = 54
const ADDRESS_X = 490

type Record = { name: string; address: string[] }

function parseFixture(text: string): Record[] {
  const records: Record[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (/^\s/.test(line)) records[records.length - 1]?.address.push(line.trim())
    else records.push({ name: line.trim(), address: [] })
  }
  return records
}

/**
 * Renders the fixture the way LCR does: address lines stacked, the name against
 * the middle one. `breakAfter` forces a page break part-way through a member so
 * the name lands on one page and the rest of the address on the next.
 */
function asPdf(records: Record[], breakAfter: number): Uint8Array {
  const pages: PdfRun[][] = []
  let runs: PdfRun[] = []
  let y = 700

  const header = () => {
    runs = [
      { text: 'Member List', x: NAME_X, y: 760 },
      { text: 'Scenic Sunrise Ward (2241102)', x: NAME_X, y: 744 },
      { text: 'Name', x: NAME_X, y: 720 },
      { text: 'Address', x: ADDRESS_X, y: 720 },
    ]
    y = 700
  }
  header()

  records.forEach((record, i) => {
    const lines = record.address.length > 0 ? record.address : ['']
    const middle = Math.floor((lines.length - 1) / 2)
    lines.forEach((address, j) => {
      if (address) runs.push({ text: address, x: ADDRESS_X, y })
      if (j === middle) runs.push({ text: record.name, x: NAME_X, y })
      // Split this member across the page: name and first line here, the rest
      // over the page.
      if (i === breakAfter && j === 0) {
        runs.push({
          text: '19 Aug 2026 For Church Use Only © 2026 by Intellectual Reserve, Inc.',
          x: NAME_X,
          y: 40,
        })
        pages.push(runs)
        header()
      } else {
        y -= 14
      }
    })
  })

  runs.push({ text: 'Count: ' + records.length, x: NAME_X, y: y - 14 })
  runs.push({
    text: '19 Aug 2026 For Church Use Only © 2026 by Intellectual Reserve, Inc.',
    x: NAME_X,
    y: 40,
  })
  pages.push(runs)
  return makePdf(pages, PAGE_WIDTH)
}

/** Plain lines, no geometry: name and first address line run together. */
function asLines(records: Record[]): Line[] {
  const text: string[] = ['Member List', 'Scenic Sunrise Ward (2241102)']
  for (const record of records) {
    const [first, ...rest] = record.address
    text.push(first ? `${record.name}  ${first}` : record.name)
    text.push(...rest)
  }
  return text.map((t) => ({
    page: 1,
    y: 0,
    runs: [{ text: t, x: 0, right: 0 }],
    text: t,
    pageWidth: PAGE_WIDTH,
  }))
}

function check(label: string, parsed: MemberParseResult, records: Record[]): string[] {
  const failures: string[] = []
  console.log(`\n--- ${label} ---`)
  console.log(
    `${parsed.rows.length} members, ${parsed.skipped.length} skipped · unit ${parsed.unitName ?? '(none)'}`,
  )

  if (parsed.rows.length !== records.length) {
    failures.push(`${parsed.rows.length} members parsed, expected ${records.length}`)
  }

  for (const record of records) {
    const row = parsed.rows.find((r) => `${r.last}, ${r.first}` === record.name)
    if (!row) {
      failures.push(`missing: ${record.name}`)
      continue
    }
    const wantCity = record.address.length > 0 ? record.address[record.address.length - 1] : null
    const wantStreet = record.address.length > 1 ? record.address.slice(0, -1).join(', ') : null
    if ((row.cityLine ?? null) !== wantCity) {
      failures.push(
        `${record.name}: city line ${row.cityLine ?? 'none'}, expected ${wantCity ?? 'none'}`,
      )
    }
    if ((row.street ?? null) !== wantStreet) {
      failures.push(
        `${record.name}: street ${row.street ?? 'none'}, expected ${wantStreet ?? 'none'}`,
      )
    }
  }

  for (const s of parsed.skipped) failures.push(`skipped: ${s.text} (${s.why})`)
  return failures.map((f) => `${label}: ${f}`)
}

run(async () => {
  const file = process.argv[2] ?? join(process.cwd(), 'scripts', 'fixtures', 'members-sample.txt')
  const records = parseFixture(await readFile(file, 'utf8'))

  // Break inside the three-line address, which is the worst case: the name is on
  // one page and two of its address lines on the next.
  const breakAfter = records.findIndex((r) => r.address.length === 3)

  const fromPdf = parseMemberReport(await extractLines(asPdf(records, breakAfter)))
  const fromText = parseMemberReport(asLines(records))

  const failures = [
    ...check('columns (real PDF, one member split across pages)', fromPdf, records),
    ...check('text only (fallback splitter)', fromText, records),
  ]

  for (const row of fromPdf.rows) {
    console.log(
      `${`${row.last}, ${row.first}`.padEnd(32)} ${(row.street ?? '(no address)').padEnd(34)} ${row.city ?? ''} ${row.state ?? ''} ${row.zip ?? ''}`,
    )
  }

  console.log()
  if (failures.length > 0) {
    for (const f of failures) console.log(`FAIL  ${f}`)
    process.exitCode = 1
    return
  }
  console.log(`ok — ${records.length} members on both paths`)
})
