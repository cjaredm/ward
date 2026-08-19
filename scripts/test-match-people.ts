/**
 * Exercises the report-name → person matcher. Reads nothing from the database, and
 * every name in it is invented — real ones live only in the database.
 *
 *   npx tsx scripts/test-match-people.ts
 */
import { PersonIndex, type DbPerson } from '../src/lib/import/match'
import { run } from './lib/run'

function person(full_name: string, family_name: string, id = full_name): DbPerson {
  return { id, full_name, household_id: `hh:${family_name}`, family_name }
}

const PEOPLE: DbPerson[] = [
  person('Dana Whitfield', 'Whitfield'),
  person('Robin Whitfield', 'Whitfield'),
  person('Marta Van Buren', 'Van Buren'),
  person('Crystal McAlister', 'Mc Alister'),
  person('Haven Prescott', 'Prescott'),
  person('Marisol Ann Kittredge', 'Kittredge'),
  person('Rebecca Harbuck Ellery', 'Ellery'),
  // Two people who answer to the same report name: 'Alder, Marcus' must not be
  // guessed at.
  person('Marcus Alder', 'Alder', 'alder-1'),
  person('Marcus Alder', 'Alder', 'alder-2'),
  person('Catherine Elizabeth DeWinter', 'DeWinter'),
]

type Case = { last: string; first: string; expect: string | 'ambiguous' | 'unmatched' }

const CASES: Case[] = [
  { last: 'Whitfield', first: 'Dana', expect: 'Dana Whitfield' },
  // The report carries a middle name the household record does not.
  { last: 'Prescott', first: 'Haven Tyler', expect: 'Haven Prescott' },
  { last: 'Kittredge', first: 'Marisol Ann', expect: 'Marisol Ann Kittredge' },
  // Two-word surname, and the same surname written closed up.
  { last: 'Van Buren', first: 'Marta', expect: 'Marta Van Buren' },
  { last: 'Mc Alister', first: 'Crystal', expect: 'Crystal McAlister' },
  { last: 'DeWinter', first: 'Catherine Elizabeth', expect: 'Catherine Elizabeth DeWinter' },
  // Surname matched off the household when the person's own name differs.
  { last: 'Ellery', first: 'Rebecca Harbuck', expect: 'Rebecca Harbuck Ellery' },
  { last: 'Alder', first: 'Marcus', expect: 'ambiguous' },
  { last: 'Nobody', first: 'Here', expect: 'unmatched' },
]

run(async () => {
  const index = new PersonIndex(PEOPLE)
  const failures: string[] = []

  for (const c of CASES) {
    const result = index.find({ last: c.last, first: c.first })
    const got =
      result.status === 'matched'
        ? result.person.full_name
        : result.status === 'ambiguous'
          ? 'ambiguous'
          : 'unmatched'
    const how = result.status === 'matched' ? `  [${result.how}]` : ''
    console.log(`${`${c.last}, ${c.first}`.padEnd(34)} → ${got}${how}`)
    if (got !== c.expect) failures.push(`${c.last}, ${c.first}: got ${got}, expected ${c.expect}`)
  }

  console.log()
  if (failures.length > 0) {
    for (const f of failures) console.log(`FAIL  ${f}`)
    process.exitCode = 1
    return
  }
  console.log(`ok — ${CASES.length} checks passed`)
})
