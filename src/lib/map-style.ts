import type { HouseholdStatus } from './types'

export const MAP_STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty'

/** Fallback view if /api/boundary is unavailable — centred on the ward. */
export const FALLBACK_VIEW = { longitude: -113.4827, latitude: 37.11, zoom: 14 }

/** How far outside the ward boundary the user can pan, in miles. */
export const BOUNDS_PADDING_MILES = 1

/** Zooming out past this would only load basemap tiles nobody needs. */
export const MIN_ZOOM = 12

/**
 * Expands a [w, s, e, n] bbox by a distance in miles.
 *
 * Longitude degrees shrink with latitude, so the east-west padding is divided by
 * cos(latitude) to keep the margin an equal distance on the ground in both axes.
 */
export function padBounds(
  bbox: number[],
  miles = BOUNDS_PADDING_MILES,
): [number, number, number, number] {
  const [w, s, e, n] = bbox
  const metres = miles * 1609.344
  const dLat = metres / 111_320
  const midLat = (s + n) / 2
  const dLon = metres / (111_320 * Math.cos((midLat * Math.PI) / 180))
  return [w - dLon, s - dLat, e + dLon, n + dLat]
}

export const STATUS_COLORS: Record<HouseholdStatus, string> = {
  active: '#2563eb',
  less_active: '#f59e0b',
  move_in: '#10b981',
  moved_out: '#a855f7',
  not_member: '#94a3b8',
  vacant: '#ef4444',
  unknown: '#cbd5e1',
}

/**
 * Parcels with no household yet. Mid-slate rather than a near-white: until data
 * entry starts every parcel uses this colour, and against OpenFreeMap's pale
 * basemap a light fill is invisible — the map reads as empty.
 */
export const NO_HOUSEHOLD_COLOR = '#94a3b8'

/**
 * Data-driven paint expression. Swapping this on the existing layer is what the
 * "Color by" dropdown will do in Phase 4 — the source is never re-rendered.
 */
export const fillColorByStatus: unknown[] = [
  'case',
  ['==', ['get', 'householdCount'], 0],
  NO_HOUSEHOLD_COLOR,
  [
    'match',
    ['get', 'status'],
    ...Object.entries(STATUS_COLORS).flatMap(([k, v]) => [k, v]),
    STATUS_COLORS.unknown,
  ],
]
