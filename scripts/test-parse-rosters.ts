/**
 * Exercises the roster parser on a real PDF, laid out the way LCR lays the
 * members variant out and broken across pages part-way through a roster.
 *
 * Every roster heading shape the report uses is in the fixture, because the
 * heading is the whole difficulty: 'Deacons Quorum Members' is a child org,
 * 'Course 15 Members' is a class that is not an org at all, and 'Elders Quorum
 * Members' names its own section. Getting one of those wrong files a roster
 * under the wrong organization, which the map then draws in the wrong colour
 * with the wrong homes in it.
 *
 * Reads nothing from the database.
 *
 *   npx tsx scripts/test-parse-rosters.ts [file.txt]
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extractLines } from '../src/lib/import/pdf'
import { parseRosterReport } from '../src/lib/import/rosters'
import { makePdf, type PdfRun } from './lib/mini-pdf'
import { run } from './lib/run'

const NAME_X = 84
const FLAG_X = 56
const HEADING_X = 54

type Entry =
  | { kind: 'section' | 'roster' | 'footnote'; text: string }
  | { kind: 'count'; text: string }
  | { kind: 'name'; text: string; flags: string }

/** Expected shape of one roster, read straight off the fixture. */
type Expected = { label: string; count: number; names: string[] }

function parseFixture(text: string): { entries: Entry[]; expected: Expected[] } {
  const entries: Entry[] = []
  const expected: Expected[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('= ')) entries.push({ kind: 'section', text: line.slice(2) })
    else if (line.startsWith('- ')) {
      const label = line.slice(2)
      entries.push({ kind: 'roster', text: label })
      expected.push({ label: label.replace(/\s+Members$/, ''), count: 0, names: [] })
    } else if (line.startsWith('! ')) entries.push({ kind: 'footnote', text: line.slice(2) })
    else if (line.startsWith('$ ')) {
      entries.push({ kind: 'count', text: `Count: ${line.slice(2)}` })
      const last = expected[expected.length - 1]
      if (last) last.count = Number(line.slice(2))
    } else {
      const m = line.match(/^((?:\*{1,2}\s+)*)(.*)$/)
      const flags = (m?.[1] ?? '').trim()
      const name = (m?.[2] ?? line).trim()
      entries.push({ kind: 'name', text: name, flags })
      expected[expected.length - 1]?.names.push(name)
    }
  }
  return { entries, expected }
}

/**
 * Renders the fixture as pages of positioned runs. Flags go in a left gutter as
 * their own runs, which is where the real report puts them and why the parser
 * reads them as tokens rather than counting characters.
 */
function asPdf(entries: Entry[], rowsPerPage: number): Uint8Array {
  const pages: PdfRun[][] = []
  let runs: PdfRun[] = []
  let y = 0
  let rows = 0
  /** Set while a roster is open, so a page break can reprint its Name header. */
  let inRoster = false

  const header = () => {
    runs = [
      { text: 'Organizations and Callings', x: HEADING_X, y: 752 },
      { text: 'Scenic Sunrise Ward (2241102)', x: 620, y: 752 },
      { text: 'Washington Utah Long Valley Stake (2334356)', x: 560, y: 740 },
    ]
    y = 712
    rows = 0
  }
  const footer = () => {
    runs.push({ text: '19 Aug 2026', x: HEADING_X, y: 40 })
    runs.push({
      text: 'For Church Use Only © 2026 by Intellectual Reserve, Inc. All rights reserved.',
      x: 240,
      y: 40,
    })
    runs.push({ text: String(pages.length + 1), x: 880, y: 40 })
    pages.push(runs)
  }
  const breakPage = () => {
    footer()
    header()
    if (inRoster) {
      runs.push({ text: 'Name', x: NAME_X, y })
      y -= 21
    }
  }

  header()
  for (const entry of entries) {
    if (rows >= rowsPerPage) breakPage()
    switch (entry.kind) {
      case 'section':
        inRoster = false
        runs.push({ text: entry.text, x: HEADING_X, y, size: 14 })
        y -= 30
        break
      case 'roster':
        inRoster = true
        runs.push({ text: entry.text, x: HEADING_X, y, size: 11 })
        y -= 24
        runs.push({ text: 'Name', x: NAME_X, y })
        y -= 21
        break
      case 'name':
        if (entry.flags) {
          // '* **' arrives as two runs, exactly as pdf.js emits them.
          let x = FLAG_X
          for (const flag of entry.flags.split(/\s+/)) {
            runs.push({ text: flag, x, y })
            x += 12
          }
        }
        runs.push({ text: entry.text, x: NAME_X, y })
        y -= 21
        rows++
        break
      case 'footnote':
        inRoster = false
        runs.push({ text: entry.text, x: HEADING_X, y })
        y -= 21
        break
      case 'count':
        inRoster = false
        runs.push({ text: entry.text, x: HEADING_X, y })
        y -= 26
        break
    }
  }
  footer()
  return makePdf(pages, 918, 792)
}

run(async () => {
  const path = process.argv[2] ?? join('scripts', 'fixtures', 'rosters-sample.txt')
  const { entries, expected } = parseFixture(await readFile(path, 'utf8'))

  // Eleven rows a page cuts several rosters in half, including one whose break
  // lands right after its heading.
  const pdf = asPdf(entries, 11)
  const parsed = parseRosterReport(await extractLines(pdf))

  console.log(`unit: ${parsed.unitName ?? '(none)'}   date: ${parsed.reportDate ?? '(none)'}`)
  console.log(`${parsed.rows.length} names in ${parsed.rosters.length} rosters\n`)

  let failures = 0
  const fail = (message: string) => {
    failures++
    console.log(`FAIL ${message}`)
  }

  if (parsed.rosters.length !== expected.length) {
    fail(`expected ${expected.length} rosters, got ${parsed.rosters.length}`)
  }

  parsed.rosters.forEach((roster, i) => {
    const want = expected[i]
    const names = parsed.rows.filter((r) => r.roster === roster.label).map((r) => r.printed)
    const unit = roster.unit ? `${roster.org} / ${roster.unit}` : roster.org
    console.log(
      `${roster.label.padEnd(34)} ${unit.padEnd(32)} ${roster.rows} rows` +
        (roster.printedCount === null ? '  (no count printed)' : ` of ${roster.printedCount}`),
    )
    if (!want) return
    if (roster.label !== want.label) fail(`roster ${i} label: ${roster.label} != ${want.label}`)
    if (roster.printedCount !== want.count) {
      fail(`${roster.label}: printed count ${roster.printedCount} != ${want.count}`)
    }
    if (roster.rows !== want.count) fail(`${roster.label}: parsed ${roster.rows} of ${want.count}`)
    const missing = want.names.filter((n) => !names.includes(n))
    if (missing.length > 0) fail(`${roster.label}: missing ${missing.join(' | ')}`)
  })

  // The headings that decide which org a roster lands in.
  const targets: [string, string, string][] = [
    ['Elders Quorum', 'elders_quorum', ''],
    ['Priests Quorum', 'priests_quorum', ''],
    ['Deacons Quorum', 'deacons_quorum', ''],
    ['Gatherers of Light', 'gatherers_of_light', ''],
    ['Adult Sunday School', 'sunday_school', 'Adult Sunday School'],
    ['Course 15', 'sunday_school', 'Course 15'],
    ['Valiant 9', 'primary', 'Valiant 9'],
    ['Primary Activities - Boys 9 & 10', 'primary', 'Primary Activities - Boys 9 & 10'],
    ['Nursery', 'nursery', ''],
    ['Young Single Adult', 'young_single_adult', ''],
  ]
  console.log()
  for (const [label, org, unit] of targets) {
    const got = parsed.rosters.find((r) => r.label === label)
    if (!got) fail(`no roster read for "${label}"`)
    else if (got.org !== org || got.unit !== unit) {
      fail(`"${label}" filed as ${got.org} / "${got.unit}", expected ${org} / "${unit}"`)
    }
  }

  // The gutter flags, on the three rows that carry them.
  const flagged = (printed: string) => parsed.rows.filter((r) => r.printed === printed)
  const jacobYsa = flagged('Ferrer, Jacob').find((r) => r.org === 'young_single_adult')
  if (!jacobYsa?.outOfDefaultClass || !jacobYsa?.notCounted) {
    fail('"* ** Ferrer, Jacob" should be both out-of-default-class and not-counted')
  }
  const jacobCourse = flagged('Ferrer, Jacob').find((r) => r.unit === 'Course 15')
  if (!jacobCourse?.outOfDefaultClass || jacobCourse?.notCounted) {
    fail('"* Ferrer, Jacob" in Course 15 should be out-of-default-class only')
  }
  const jordyn = flagged('Brennan, Jordyn')[0]
  if (jordyn?.outOfDefaultClass || !jordyn?.notCounted) {
    fail('"** Brennan, Jordyn" should be not-counted only')
  }
  if (parsed.rows.some((r) => r.printed.startsWith('*'))) fail('a flag leaked into a name')

  if (parsed.skipped.length > 0) {
    console.log(`\n${parsed.skipped.length} line(s) skipped:`)
    for (const s of parsed.skipped) console.log(`  p${s.page}: ${s.text} — ${s.why}`)
    fail(`${parsed.skipped.length} line(s) could not be read`)
  }

  console.log(failures === 0 ? '\nOK' : `\n${failures} failure(s)`)
  if (failures > 0) process.exitCode = 1
})
