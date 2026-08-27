import type { Pt } from './floorplan-geom'

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

/**
 * One room on the building map.
 *
 * `points` is an open ring in the floorplan's own coordinate units — see
 * `src/lib/floorplan-geom.ts` for why the geometry is not PostGIS.
 */
export type BuildingRoom = {
  /** Slug from the drawing: 'high-council', '101'. Stable, and it goes in URLs. */
  key: string
  name: string
  points: Pt[]
  /** Hand-placed label anchor, or null to use the computed one. */
  label: Pt | null
  /**
   * False for hallways, the serving area and the platform. They are on the
   * drawing because the drawing is the building, but nothing meets in them, and
   * without this they sit in "rooms free this hour" forever.
   *
   * Building-wide, and deliberately blunt. Whether a room that *does* hold
   * classes is free in a particular hour is `RoomSlotAvailability`, which
   * overrides this one hour at a time.
   */
  is_assignable: boolean
  sort: number
}

/**
 * One 25-minute block of a Sunday.
 *
 * The id is opaque on purpose. The block moves from 9:10 to 9:15 whenever the
 * stake reshuffles, and an assignment has to survive that as an UPDATE of this
 * one row rather than a rewrite of everything that referenced the old time.
 */
export type MeetingSlot = {
  id: string
  /** Overrides the derived '9:10 – 9:35'. Some wards want '2nd hour' instead. */
  label: string | null
  /** 'HH:MM:SS' as Postgres `time` renders it. */
  starts_at: string
  ends_at: string
  sort: number
  is_active: boolean
}

/** A class meeting in a room during one block. */
export type RoomAssignment = {
  id: string
  room_key: string
  slot_id: string
  /** Authoritative for display. Free text: classes renumber every January. */
  title: string
  /**
   * The optional link into the roster model — the same (org_key, unit) pair
   * `person_orgs` and `callings` already key classes on, so resolving this
   * class's members and teachers later is a query and not a migration.
   */
  org_key: string | null
  unit: string
  notes: string | null
  sort: number
}

/** A class the ward already has data for, offered as the org link picker. */
export type ClassOption = {
  org_key: string
  /** '' for the organization itself, otherwise 'Course 15', 'Valiant 9'. */
  unit: string
  /** How many people are in it, shown next to the option. */
  people: number
}

/**
 * A class option as the database hands it over, before the picker's filter.
 *
 * `roster` is the count from `person_orgs` alone — people *in* the class, as
 * opposed to people with a calling attached to it. That split is what separates
 * Course 15 from the Sunday School Presidency; see `isClassOption`.
 */
export type ClassOptionRow = ClassOption & {
  roster: number
}

/**
 * One deliberate answer to "can a class meet in this room during this hour",
 * overriding the room's own `is_assignable` for that hour only.
 *
 * Only the overrides exist: a room with no row for an hour follows the room. So
 * the chapel is marked unavailable first hour without anybody having to fill in
 * a 35-by-2 grid, and a new hour starts out inheriting the building.
 */
export type RoomSlotAvailability = {
  room_key: string
  slot_id: string
  is_available: boolean
}

/** Everything the building map needs, in one response. */
export type BuildingData = {
  rooms: BuildingRoom[]
  slots: MeetingSlot[]
  assignments: RoomAssignment[]
  availability: RoomSlotAvailability[]
  classOptions: ClassOption[]
}
