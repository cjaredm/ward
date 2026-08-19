/**
 * Matching a name off an LCR report to a person already in the database.
 *
 * The two sides write names differently and neither is wrong:
 *
 *   report                     database
 *   Mortenson, Jared           Jared Mortenson
 *   Powell, Haven Tyler        Haven Powell            (report carries the middle name)
 *   Van Ausdal, Jolene         Jolene Van Ausdal       (two-word surname)
 *   Silvester, Heather Anne    Heather Anne Silvester
 *   Mc Elyea, Crystal          Crystal McElyea         (spacing differs)
 *
 * So a report name is compared to a person on the parts that survive all of
 * that: the surname, and the first given name. Anything that matches more than
 * one person is reported as ambiguous rather than guessed at — attaching the
 * Bishop's calling to the wrong Cash is worse than leaving a row for a human.
 */
import { editDistance } from '../address'

export type DbPerson = {
  id: string
  full_name: string
  household_id: string
  /** The household's family name. Often the surname the report prints. */
  family_name: string
}

export type MatchQuery = { last: string | null; first: string | null }

export type MatchResult =
  | { status: 'matched'; person: DbPerson; how: string }
  | { status: 'ambiguous'; candidates: DbPerson[] }
  | { status: 'unmatched' }

/** Uppercase, unaccented, punctuation-free, single-spaced. */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 'Mc Elyea' and 'McElyea' are the same surname. */
function squash(value: string): string {
  return normalize(value).replace(/ /g, '')
}

type Indexed = {
  person: DbPerson
  tokens: string[]
  /** Surname as squashed text: the trailing token, plus any particle before it. */
  surname: string
  family: string
}

const PARTICLES = new Set(['VAN', 'VON', 'DE', 'DEL', 'DER', 'DI', 'DU', 'LA', 'LE', 'MC', 'MAC', 'ST'])

function index(person: DbPerson): Indexed {
  const tokens = normalize(person.full_name).split(' ').filter(Boolean)
  let from = Math.max(0, tokens.length - 1)
  while (from > 1 && PARTICLES.has(tokens[from - 1])) from--
  return {
    person,
    tokens,
    surname: tokens.slice(from).join(''),
    family: squash(person.family_name),
  }
}

export class PersonIndex {
  private readonly entries: Indexed[]

  constructor(people: DbPerson[]) {
    this.entries = people.map(index)
  }

  /**
   * Best match for a report name, or why there isn't one.
   *
   * Tiers, strongest first. Each tier only runs when the one above it found
   * nothing, so a shaky match never beats a solid one, and a tier that finds
   * several people stops the search rather than falling through to a looser rule
   * that might find one by accident.
   */
  find(query: MatchQuery): MatchResult {
    const last = query.last ? squash(query.last) : ''
    const firstTokens = query.first ? normalize(query.first).split(' ').filter(Boolean) : []
    const first = firstTokens[0] ?? ''
    if (!last || !first) return { status: 'unmatched' }

    const whole = squash(`${query.first} ${query.last}`)

    const tiers: [string, (e: Indexed) => boolean][] = [
      // Every token, in order: 'Heather Anne Silvester' for 'Silvester, Heather Anne'.
      ['full name', (e) => e.tokens.join('') === whole],
      // Surname plus first given name. Drops the report's middle names.
      ['surname + first name', (e) => e.surname === last && e.tokens[0] === first],
      // Surname taken from the household rather than the person's own name.
      ['family name + first name', (e) => e.family === last && e.tokens[0] === first],
      // One typo in the given name, surname exact. 'Cathy' for 'Kathy' is not
      // reachable this way, which is deliberate — that is a human's call.
      [
        'surname + near first name',
        (e) => e.surname === last && editDistance(e.tokens[0] ?? '', first, 1) <= 1,
      ],
    ]

    for (const [how, test] of tiers) {
      const hits = this.entries.filter(test)
      if (hits.length === 1) return { status: 'matched', person: hits[0].person, how }
      if (hits.length > 1) return { status: 'ambiguous', candidates: hits.map((h) => h.person) }
    }

    return { status: 'unmatched' }
  }
}
