/**
 * The ward's organizations, mirrored from the `orgs` table.
 *
 * The table is the source of truth at runtime — the org chart reads it — but the
 * importer has to turn a heading printed on a PDF into an org key without a
 * round trip per row, and the UI needs labels before any data loads. So the
 * seeded set is repeated here, and `ORG_KEYS` is what the API validates against.
 *
 * Adding an org means: INSERT into `orgs` (a migration) and add it here.
 */
export type OrgKey =
  | 'bishopric'
  | 'elders_quorum'
  | 'relief_society'
  | 'young_men'
  | 'priests_quorum'
  | 'teachers_quorum'
  | 'deacons_quorum'
  | 'young_women'
  | 'gatherers_of_light'
  | 'messengers_of_hope'
  | 'builders_of_faith'
  | 'primary'
  | 'nursery'
  | 'sunday_school'
  | 'ward_missionaries'
  | 'temple_family_history'
  | 'young_single_adult'
  | 'other'

export type Org = { key: OrgKey; label: string; parent: OrgKey | null; sort: number }

export const ORGS: readonly Org[] = [
  { key: 'bishopric', label: 'Bishopric', parent: null, sort: 10 },
  { key: 'elders_quorum', label: 'Elders Quorum', parent: null, sort: 20 },
  { key: 'relief_society', label: 'Relief Society', parent: null, sort: 30 },
  { key: 'young_men', label: 'Young Men', parent: null, sort: 40 },
  { key: 'priests_quorum', label: 'Priests Quorum', parent: 'young_men', sort: 10 },
  { key: 'teachers_quorum', label: 'Teachers Quorum', parent: 'young_men', sort: 20 },
  { key: 'deacons_quorum', label: 'Deacons Quorum', parent: 'young_men', sort: 30 },
  { key: 'young_women', label: 'Young Women', parent: null, sort: 50 },
  { key: 'gatherers_of_light', label: 'Gatherers of Light', parent: 'young_women', sort: 10 },
  { key: 'messengers_of_hope', label: 'Messengers of Hope', parent: 'young_women', sort: 20 },
  { key: 'builders_of_faith', label: 'Builders of Faith', parent: 'young_women', sort: 30 },
  { key: 'primary', label: 'Primary', parent: null, sort: 60 },
  { key: 'nursery', label: 'Nursery', parent: 'primary', sort: 10 },
  { key: 'sunday_school', label: 'Sunday School', parent: null, sort: 70 },
  { key: 'ward_missionaries', label: 'Ward Missionaries', parent: null, sort: 80 },
  { key: 'temple_family_history', label: 'Temple and Family History', parent: null, sort: 90 },
  { key: 'young_single_adult', label: 'Young Single Adult', parent: null, sort: 100 },
  { key: 'other', label: 'Other Callings', parent: null, sort: 110 },
] as const

export const ORG_KEYS = ORGS.map((o) => o.key) as OrgKey[]

const BY_KEY = new Map<string, Org>(ORGS.map((o) => [o.key, o]))

export function org(key: string): Org | undefined {
  return BY_KEY.get(key)
}

export function orgLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key
}

/** 'Deacons Quorum' → 'Young Men › Deacons Quorum'. */
export function orgPath(key: string): string {
  const o = BY_KEY.get(key)
  if (!o) return key
  return o.parent ? `${orgLabel(o.parent)} › ${o.label}` : o.label
}

export function isOrgKey(value: string): value is OrgKey {
  return BY_KEY.has(value)
}

/**
 * The top-level headings LCR prints on "Organizations and Callings", mapped to
 * org keys. Matched case-insensitively on the whole heading line.
 */
const REPORT_HEADINGS: Record<string, OrgKey> = {
  bishopric: 'bishopric',
  'elders quorum': 'elders_quorum',
  'relief society': 'relief_society',
  'aaronic priesthood quorums': 'young_men',
  'young men': 'young_men',
  'young women': 'young_women',
  'sunday school': 'sunday_school',
  primary: 'primary',
  'ward missionaries': 'ward_missionaries',
  'temple and family history': 'temple_family_history',
  'young single adult': 'young_single_adult',
  'other callings': 'other',
}

export function orgForHeading(heading: string): OrgKey | null {
  return REPORT_HEADINGS[heading.trim().toLowerCase()] ?? null
}

/**
 * Sub-headings that belong to a child org rather than the section they are
 * printed under. 'Priests Quorum Presidency' sits inside the Aaronic Priesthood
 * Quorums section but is Priests Quorum work.
 *
 * Prefix match, longest first, so 'Gatherers of Light Class Adult Leaders' and
 * 'Gatherers of Light Class Presidency' both land on the same child.
 */
const SUBHEADING_ORGS: [string, OrgKey][] = [
  ['priests quorum', 'priests_quorum'],
  ['teachers quorum', 'teachers_quorum'],
  ['deacons quorum', 'deacons_quorum'],
  ['gatherers of light', 'gatherers_of_light'],
  ['messengers of hope', 'messengers_of_hope'],
  ['builders of faith', 'builders_of_faith'],
  ['nursery', 'nursery'],
]

/**
 * Refines a section's org using the sub-heading a calling was printed under.
 * Returns the section's own org when the sub-heading is a plain grouping
 * ('Presidency', 'Teachers', 'Activities', 'Course 15').
 */
export function refineOrg(section: OrgKey, subheading: string | null): OrgKey {
  if (!subheading) return section
  const lower = subheading.trim().toLowerCase()
  for (const [prefix, key] of SUBHEADING_ORGS) {
    if (lower.startsWith(prefix)) {
      // Only ever refine downward, and only within the section being read: the
      // Presidency of the Aaronic Priesthood lists the bishopric, and those
      // three men are not Priests Quorum leaders.
      const child = BY_KEY.get(key)
      if (child?.parent === section || key === section) return key
    }
  }
  return section
}

/**
 * Where a roster on the members variant of the report belongs.
 *
 * That report prints one roster per organization and per class, each under a
 * heading of its own: 'Elders Quorum Members', 'Gatherers of Light Members',
 * 'Course 15 Members', 'Primary Activities - Boys 9 & 10 Members'.
 *
 * Some of those headings name a seeded org and some name a class that only this
 * ward has. Both end up as an (org, unit) pair, with `unit` empty when the
 * heading is the organization itself — the same shape `callings` already stores,
 * so a class the callings report mentions and a class the roster lists are one
 * group rather than two.
 */
export function rosterTarget(section: OrgKey, heading: string): { org: OrgKey; unit: string } {
  const name = heading.trim().replace(/\s+Members$/i, '').trim()

  // A heading that names a child org is that org, not a class inside the
  // section: 'Deacons Quorum Members' under 'Aaronic Priesthood Quorums'.
  const refined = refineOrg(section, name)
  if (refined !== section) return { org: refined, unit: '' }

  // 'Elders Quorum Members' under Elders Quorum names the section itself.
  if (normalizeHeading(name) === normalizeHeading(orgLabel(section))) {
    return { org: section, unit: '' }
  }

  return { org: section, unit: name }
}

/** Case- and space-insensitive, so 'Young  Single Adult' still matches its label. */
function normalizeHeading(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Every place a roster's membership counts.
 *
 * A Gatherers of Light girl is in Young Women. A Valiant 9 child is in Primary.
 * The roll-up is what makes 'Young Women' on the map mean the whole
 * organization rather than only the girls whose class heading happened to be
 * read — and it is one level, matching how the callings import rolls a child
 * org's callings up to its parent.
 */
export function membershipTargets(org: OrgKey, unit: string): { org: OrgKey; unit: string }[] {
  const out = [{ org, unit }]
  if (unit) out.push({ org, unit: '' })
  const parent = BY_KEY.get(org)?.parent
  if (parent) out.push({ org: parent, unit: '' })
  return out
}

/**
 * One colour per organization, so a block of it is recognised before it is read.
 *
 * Child organizations sit near their parent's hue — the three Young Women classes
 * are all purple, the Aaronic Priesthood quorums all blue — which is what makes
 * the org chart legible folded down to its presidencies.
 *
 * Shared rather than owned by the chart: the map highlights the same
 * organizations, and a quorum that is teal in one place and magenta in the other
 * is two facts to learn instead of one.
 */
export const ORG_TINT: Record<string, string> = {
  bishopric: '#4338ca',
  elders_quorum: '#0e7490',
  relief_society: '#be185d',
  young_men: '#1d4ed8',
  priests_quorum: '#2563eb',
  teachers_quorum: '#3b82f6',
  deacons_quorum: '#60a5fa',
  young_women: '#a21caf',
  gatherers_of_light: '#c026d3',
  messengers_of_hope: '#9333ea',
  builders_of_faith: '#d946ef',
  primary: '#ea580c',
  nursery: '#d97706',
  sunday_school: '#15803d',
  ward_missionaries: '#0f766e',
  temple_family_history: '#7c3aed',
  young_single_adult: '#0891b2',
  other: '#525252',
}

/** Neutral grey, for an org key nothing has a colour for yet. */
const NO_TINT = '#525252'

export function orgTint(key: string): string {
  return ORG_TINT[key] ?? NO_TINT
}

/**
 * Multiplies every channel of a hex colour, keeping the hue and spending only
 * the lightness. Enough for one darker step, and unlike a hand-picked second
 * palette it cannot drift out of step with the first.
 */
function darken(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const channel = (shift: number) =>
    Math.round(((n >> shift) & 0xff) * factor)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(16)}${channel(8)}${channel(0)}`
}

const ORG_INK = new Map(Object.entries(ORG_TINT).map(([key, hex]) => [key, darken(hex, 0.6)]))

/**
 * The same colour, dark enough to read as small text.
 *
 * The tints are picked to be recognised as an area of colour, which leaves the
 * lighter ones — '#60a5fa' for the deacons — illegible at 11px, and a map label
 * has nothing but a white halo behind it.
 */
export function orgInk(key: string): string {
  return ORG_INK.get(key) ?? darken(NO_TINT, 0.6)
}
