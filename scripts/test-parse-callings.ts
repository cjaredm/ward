/**
 * Exercises the callings parser twice over scripts/fixtures/callings-sample.txt, on both of
 * the paths a real upload can take:
 *
 *   columns  the sample is rendered into a real two-column PDF, extracted with
 *            the same code the upload route uses, and split on x coordinates.
 *            This is the path that runs in production.
 *   text     the sample is fed in as plain lines with no geometry, exercising
 *            the fallback splitter — the one that has to get 'Van Ausdal' and
 *            the heading 'CTR 5, CTR 6' right without a column to cut on.
 *
 * Reads nothing from the database.
 *
 *   npx tsx scripts/test-parse-callings.ts [file.txt]
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseCallingsReport, type ParseResult } from '../src/lib/import/callings'
import { extractLines, type Line } from '../src/lib/import/pdf'
import { makePdf, type PdfRun } from './lib/mini-pdf'
import { run } from './lib/run'

/** Where LCR puts the two columns on its landscape page, in points. */
const PAGE_WIDTH = 918
const CALLING_X = 54
const NAME_X = 528

/** One line per row, no runs to split on. */
function asLines(text: string): Line[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((t) => ({
      page: 1,
      y: 0,
      runs: [{ text: t, x: 0, right: 0 }],
      text: t,
      pageWidth: 612,
    }))
}

/**
 * Renders the sample as a two-column PDF: the label in the calling column, the
 * name in the name column, and a 'Calling / Name' header on each page — which is
 * what the parser learns the split point from.
 */
function asPdf(lines: string[]): Uint8Array {
  const pages: PdfRun[][] = []
  let runs: PdfRun[] = []
  let y = 720

  const newPage = () => {
    if (runs.length > 0) pages.push(runs)
    runs = [
      { text: 'Organizations and Callings Scenic Sunrise Ward (2241102)', x: CALLING_X, y: 760 },
      { text: 'Calling', x: CALLING_X, y: 740 },
      { text: 'Name', x: NAME_X, y: 740 },
    ]
    y = 720
  }
  newPage()

  for (const line of lines) {
    const split = splitSampleLine(line)
    if (split) {
      runs.push({ text: split.calling, x: CALLING_X, y })
      runs.push({ text: split.name, x: NAME_X, y })
    } else {
      runs.push({ text: line, x: CALLING_X, y })
    }
    y -= 14
    if (y < 80) newPage()
  }

  runs.push({
    text: '19 Aug 2026 For Church Use Only © 2026 by Intellectual Reserve, Inc. All rights reserved.',
    x: CALLING_X,
    y: 40,
  })
  pages.push(runs)
  // pdf.js drops glyphs that fall outside the MediaBox, so the synthetic page has
  // to be as wide as the real report or long names come back clipped.
  return makePdf(pages, PAGE_WIDTH)
}

/**
 * Splits a sample line into the two cells LCR would have printed. Deliberately
 * dumb and independent of the parser: it uses the sample's own comma, so a bug
 * in the parser cannot hide behind a matching bug here.
 */
function splitSampleLine(line: string): { calling: string; name: string } | null {
  if (/ Calling Vacant$/.test(line)) {
    return { calling: line.replace(/ Calling Vacant$/, ''), name: 'Calling Vacant' }
  }
  const m = line.match(/^(.*?)((?:Van|Mc|De|Le|La|St) )?([A-Za-z'’-]+, .+)$/)
  if (!m) return null
  return { calling: m[1].trim(), name: `${m[2] ?? ''}${m[3]}`.trim() }
}

type Expected = { calling: string; org: string; last: string | null; first: string | null }

const EXPECT: Expected[] = [
  { calling: 'Bishop', org: 'bishopric', last: 'Alder', first: 'Marcus' },
  { calling: 'Ward Assistant Clerk', org: 'bishopric', last: null, first: null },
  { calling: 'Ward Assistant Clerk--Membership', org: 'bishopric', last: 'Okonkwo', first: 'Tobi' },
  {
    calling: 'Ward Healing Trough the Savior Mentor',
    org: 'elders_quorum',
    last: 'Ramsey',
    first: 'Neil',
  },
  // Two-word surname: the fallback splitter has to cut before 'Van'.
  {
    calling: 'Relief Society Ministering Secretary',
    org: 'relief_society',
    last: 'Van Buren',
    first: 'Marta',
  },
  {
    calling: 'Relief Society Service Coordinator',
    org: 'relief_society',
    last: 'Mc Alister',
    first: 'Crystal',
  },
  // Sub-heading refines the org: printed under Aaronic Priesthood Quorums,
  // belongs to the Teachers Quorum.
  {
    calling: 'Teachers Quorum President',
    org: 'teachers_quorum',
    last: 'Prescott',
    first: 'Haven Tyler',
  },
  {
    calling: 'Deacons Quorum Adviser',
    org: 'deacons_quorum',
    last: 'Ferrer',
    first: 'Bruce Adam',
  },
  {
    calling: 'Gatherers of Light Class Second Counselor',
    org: 'gatherers_of_light',
    last: 'Jenson',
    first: 'ElizaJane',
  },
  { calling: 'Sunday School Teacher', org: 'sunday_school', last: 'Corbin', first: 'James E' },
  // Printed under the class heading 'CTR 5, CTR 6', which is a heading despite
  // the comma.
  { calling: 'Primary Teacher', org: 'primary', last: 'Castellano', first: 'Manuel' },
  {
    calling: 'Valiant Activities Leader',
    org: 'primary',
    last: 'DeWinter',
    first: 'Catherine Elizabeth',
  },
  { calling: 'Scheduler--Building 1', org: 'other', last: 'Osgood', first: 'Randy Morris' },
  { calling: 'Ward Activity Committee Member', org: 'other', last: 'Mcbride', first: 'Jennifer' },
]

function check(label: string, parsed: ParseResult, verbose: boolean): string[] {
  console.log(`\n--- ${label} ---`)
  console.log(`unit: ${parsed.unitName ?? '(not found)'}   date: ${parsed.reportDate ?? '(not found)'}`)
  console.log(`${parsed.rows.length} rows, ${parsed.skipped.length} skipped`)

  if (verbose) {
    for (const r of parsed.rows) {
      const who = r.vacant ? '(vacant)' : `${r.last} / ${r.first}`
      console.log(
        `${r.org.padEnd(20)} ${(r.unit ?? '-').padEnd(34)} ${r.calling.padEnd(42)} ${who}${r.isCustom ? '  [custom]' : ''}`,
      )
    }
  }

  const failures: string[] = []

  // The bishopric is printed twice; the second listing must not import again.
  const bishops = parsed.rows.filter((r) => r.calling === 'Bishop')
  if (bishops.length !== 1) failures.push(`Bishop appears ${bishops.length}x, expected 1`)

  for (const want of EXPECT) {
    const hit = parsed.rows.find(
      (r) => r.calling === want.calling && r.last === want.last && r.first === want.first,
    )
    if (!hit) {
      failures.push(`missing: ${want.calling} → ${want.last}, ${want.first}`)
      continue
    }
    if (hit.org !== want.org) {
      failures.push(`${want.calling}: org ${hit.org}, expected ${want.org}`)
    }
  }

  for (const s of parsed.skipped) failures.push(`skipped p${s.page}: ${s.text} (${s.why})`)

  return failures.map((f) => `${label}: ${f}`)
}

run(async () => {
  const file =
    process.argv[2] ?? join(process.cwd(), 'scripts', 'fixtures', 'callings-sample.txt')
  const text = await readFile(file, 'utf8')
  const sample = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))

  const failures = [
    ...check('columns (real PDF)', parseCallingsReport(await extractLines(asPdf(sample))), true),
    ...check('text only (fallback splitter)', parseCallingsReport(asLines(text)), false),
  ]

  console.log()
  if (failures.length > 0) {
    for (const f of failures) console.log(`FAIL  ${f}`)
    process.exitCode = 1
    return
  }
  console.log(`ok — ${EXPECT.length} checks passed on both paths`)
})
