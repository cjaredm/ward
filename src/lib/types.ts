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

/** Properties carried on each parcel feature in /api/parcels. Kept short — 539 of them ship per request. */
export type ParcelProperties = {
  pid: string
  address: string | null
  residential: boolean
  familyName: string | null
  status: HouseholdStatus | null
  householdCount: number
}

export type ParcelFeature = {
  type: 'Feature'
  id: string
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] }
  properties: ParcelProperties
}

export type ParcelCollection = {
  type: 'FeatureCollection'
  features: ParcelFeature[]
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
  parcel_id: string
  family_name: string
  status: HouseholdStatus
  notes: string | null
  updated_at: string
  updated_by: string | null
  people: Person[]
}

export type ParcelDetail = {
  parcel: {
    parcel_id: string
    address: string | null
    city: string | null
    zip: string | null
    own_type: string | null
    coparcel_url: string | null
    in_ward: boolean
    is_residential: boolean
  }
  households: Household[]
}
