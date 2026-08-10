/**
 * Street-address normalization, used to join a hand-typed ward directory against
 * the county parcel layer.
 *
 * The two sides disagree constantly and none of it is meaningful:
 *
 *   directory                     county
 *   1594 Amity Lane               1594 S AMITY LN        (no directional, spelled-out type)
 *   1579 So. Scenic Sunrise Dr.   1579 S SCENIC SUNRISE DR
 *   1556 Scenic Sunrise           1556 S SCENIC SUNRISE DR  (type missing entirely)
 *   1651 E Sunscrest Cir          1651 E SUNCREST CIR    (typo)
 *
 * So an address is parsed into parts and compared on the parts that survive
 * sloppy transcription: the house number and the street's core name. The
 * directional and the street type are kept for tie-breaking only.
 */

export type Address = {
  /** As printed, for display and for storing on a pinned household. */
  raw: string
  /** House number. '1594' */
  num: string
  /** N/S/E/W, or null when the directory left it off. */
  dir: string | null
  /** Street name with the directional and type stripped. 'SCENIC SUNRISE' */
  core: string
  /** Canonical street type. 'DR' */
  type: string | null
  /** Unit / apartment designator, or null. */
  unit: string | null
}

const DIRECTIONALS: Record<string, string> = {
  N: 'N',
  S: 'S',
  E: 'E',
  W: 'W',
  NE: 'NE',
  NW: 'NW',
  SE: 'SE',
  SW: 'SW',
  NO: 'N',
  SO: 'S',
  NORTH: 'N',
  SOUTH: 'S',
  EAST: 'E',
  WEST: 'W',
}

const STREET_TYPES: Record<string, string> = {
  DR: 'DR',
  DRIVE: 'DR',
  LN: 'LN',
  LANE: 'LN',
  ST: 'ST',
  STREET: 'ST',
  RD: 'RD',
  ROAD: 'RD',
  CIR: 'CIR',
  CIRCLE: 'CIR',
  CT: 'CT',
  COURT: 'CT',
  WAY: 'WAY',
  AVE: 'AVE',
  AVENUE: 'AVE',
  BLVD: 'BLVD',
  BOULEVARD: 'BLVD',
  PL: 'PL',
  PLACE: 'PL',
  PKWY: 'PKWY',
  PARKWAY: 'PKWY',
  TER: 'TER',
  TERRACE: 'TER',
  LOOP: 'LOOP',
  TRL: 'TRL',
  TRAIL: 'TRL',
}

const UNIT_WORDS = new Set(['UNIT', 'APT', 'APARTMENT', 'STE', 'SUITE', '#', 'LOT', 'SPC'])

/**
 * Parses an address into comparable parts. Returns null when there is no leading
 * house number — a PO box, a landmark, or an empty cell.
 */
export function parseAddress(raw: string): Address | null {
  const cleaned = raw
    .toUpperCase()
    // '#12' has to survive as its own token; '.' and ',' are pure noise.
    .replace(/#/g, ' # ')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null

  let tokens = cleaned.split(' ')

  // Unit designator, wherever it appears. Everything from the keyword onward is
  // the unit: '1462 E MIDWAY ST UNIT 1'.
  let unit: string | null = null
  const unitAt = tokens.findIndex((t) => UNIT_WORDS.has(t))
  if (unitAt > 0) {
    unit = tokens.slice(unitAt + 1).join(' ') || null
    tokens = tokens.slice(0, unitAt)
  }

  const num = tokens[0]
  if (!/^\d+[A-Z]?$/.test(num ?? '')) return null
  tokens = tokens.slice(1)

  let dir: string | null = null
  if (tokens.length > 1 && DIRECTIONALS[tokens[0]]) {
    dir = DIRECTIONALS[tokens[0]]
    tokens = tokens.slice(1)
  }

  let type: string | null = null
  if (tokens.length > 1 && STREET_TYPES[tokens[tokens.length - 1]]) {
    type = STREET_TYPES[tokens[tokens.length - 1]]
    tokens = tokens.slice(0, -1)
  }

  const core = tokens.join(' ').trim()
  if (!core) return null

  return { raw: raw.trim(), num, dir, core, type, unit }
}

/** Every part. Two addresses sharing this key are the same address, no judgment. */
export function fullKey(a: Address): string {
  return [a.num, a.dir ?? '-', a.core, a.type ?? '-', a.unit ?? '-'].join('|')
}

/**
 * House number plus street core. This is the key that actually does the work:
 * it survives a missing directional, a spelled-out street type and a stray
 * period, all of which the directory has.
 */
export function coreKey(a: Address): string {
  return `${a.num}|${a.core}`
}

/** Levenshtein distance, capped — used only to forgive typos in a street name. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > cap) return cap + 1

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      row.push(v)
      if (v < best) best = v
    }
    if (best > cap) return cap + 1
    prev = row
  }
  return prev[b.length]
}
