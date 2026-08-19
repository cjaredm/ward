export const HOUSEHOLD_STATUSES = [
  'active',
  'less_active',
  'move_in',
  'moved_out',
  'not_member',
  'vacant',
  'unknown',
] as const

export type HouseholdStatus = (typeof HOUSEHOLD_STATUSES)[number]

export const STATUS_LABELS: Record<HouseholdStatus, string> = {
  active: 'Active',
  less_active: 'Less active',
  move_in: 'Move-in',
  moved_out: 'Moved out',
  not_member: 'Not a member',
  vacant: 'Vacant',
  unknown: 'Unknown',
}

export const PARCEL_USES = ['residence', 'business', 'common_area'] as const
export type ParcelUse = (typeof PARCEL_USES)[number]

export const USE_LABELS: Record<ParcelUse, string> = {
  residence: 'Home',
  business: 'Business',
  common_area: 'Common area',
}

/**
 * Properties on each feature in /api/parcels. Kept short — ~500 ship per request.
 *
 * The collection mixes two kinds of feature: `parcel` polygons from the county,
 * and `pin` points for households at addresses the county has no parcel for.
 * `kind` is what the map layers filter on.
 */
export type ParcelProperties = {
  kind: 'parcel'
  /** 'manual' parcels were traced by hand and are never touched by the import. */
  source: 'county' | 'manual'
  pid: string
  address: string | null
  use: ParcelUse
  /** First tenant on a business parcel — what the map labels it with. */
  businessName: string | null
  /** Tenants on this parcel, so the label can show "+2" for a shared unit. */
  businessCount: number
  familyName: string | null
  status: HouseholdStatus | null
  householdCount: number
}

export type PinProperties = {
  kind: 'pin'
  hid: string
  familyName: string
  status: HouseholdStatus
  address: string | null
}

export type ParcelFeature = {
  type: 'Feature'
  id: string
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] }
  properties: ParcelProperties
}

export type PinFeature = {
  type: 'Feature'
  id: string
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: PinProperties
}

export type ParcelCollection = {
  type: 'FeatureCollection'
  features: (ParcelFeature | PinFeature)[]
}

/** One calling a person holds. Many per person is normal — a clerk is often two. */
export type PersonCalling = {
  id: string
  org_key: string
  name: string
  /** Sub-heading it was printed under on the LCR report: 'Valiant 9', 'Ministering'. */
  unit: string | null
  /** True for callings this ward created rather than standard ones. */
  is_custom: boolean
}

export type Person = {
  id: string
  full_name: string
  sort_order: number
  /**
   * Link to a picture of this person, or null — which is the normal case. Not an
   * uploaded file: see migration 0012 for why the app keeps the URL only.
   */
  photo_url: string | null
  /** Live callings, in report order. Written by the callings import. */
  callings: PersonCalling[]
  /** Org keys this person belongs to, derived from their callings or set by hand. */
  orgs: string[]
}

export type Household = {
  id: string
  /** null for households pinned to a point instead of a county parcel. */
  parcel_id: string | null
  family_name: string
  status: HouseholdStatus
  notes: string | null
  /** Hand-typed address, only used for pinned households. */
  address: string | null
  updated_at: string
  updated_by: string | null
  people: Person[]
}

/**
 * One tenant of a business parcel. Multi-tenant units are the normal case here,
 * so these are rows against parcel_id exactly like households are.
 */
export type Business = {
  id: string
  parcel_id: string
  name: string
  category: string | null
  notes: string | null
  /** 'overture' rows were matched from the public POI dataset, not typed by hand. */
  source: string
  updated_at: string
  updated_by: string | null
}

export type ParcelSummary = {
  parcel_id: string
  address: string | null
  city: string | null
  zip: string | null
  own_type: string | null
  coparcel_url: string | null
  in_ward: boolean
  use_type: ParcelUse
  source: 'county' | 'manual'
}

export type ParcelDetail = {
  /** null when the panel is showing a pinned household with no parcel behind it. */
  parcel: ParcelSummary | null
  households: Household[]
  businesses: Business[]
}

/** Turns a raw category slug from the POI import into something readable. */
export function categoryLabel(category: string | null): string | null {
  if (!category) return null
  const words = category.replace(/_/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : null
}

/** One person in a map group, with the home to highlight for them. */
export type MapGroupMember = {
  personId: string
  name: string
  householdId: string
  familyName: string
  /** County parcel behind their household, or null when it is a loose pin. */
  parcelId: string | null
  /** What they do in this group, for the member list beside the map. */
  callings: string[]
  /**
   * How they reach this group.
   *
   * 'roster' is on it because LCR printed them on it; 'serves' is on it because
   * they hold a calling in it. Most of a Primary class is 'roster' and its
   * teachers are 'serves', which is the difference between the children and the
   * adults on a highlight of it — and 'both' is the class president.
   */
  via: 'roster' | 'serves' | 'both'
}

/**
 * A set of people the map can highlight in one click: an organization, or a class
 * inside one ('Valiant 9', 'Course 15', 'Ministering').
 */
export type MapGroup = {
  /** 'org:elders_quorum' or 'unit:primary|Valiant 9'. What the UI selects on. */
  key: string
  kind: 'org' | 'unit'
  label: string
  /** The org this sits under: a child org's parent, or a unit's own org. */
  parentLabel: string | null
  orgKey: string
  members: MapGroupMember[]
  /** Members on the roster — the size of the organization or class itself. */
  rosterCount: number
  /** Members who hold a calling in it. */
  servesCount: number
}
