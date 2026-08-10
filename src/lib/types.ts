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

export type Person = {
  id: string
  full_name: string
  role: string | null
  phone: string | null
  email: string | null
  sort_order: number
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
