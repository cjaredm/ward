import type { HouseholdStatus } from './types'

export const MAP_STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty'

/** Fallback view if /api/boundary is unavailable — centred on the ward. */
export const FALLBACK_VIEW = { longitude: -113.4827, latitude: 37.11, zoom: 14 }

export const STATUS_COLORS: Record<HouseholdStatus, string> = {
  active: '#2563eb',
  less_active: '#f59e0b',
  move_in: '#10b981',
  moved_out: '#a855f7',
  not_member: '#94a3b8',
  vacant: '#ef4444',
  unknown: '#cbd5e1',
}

export const NO_HOUSEHOLD_COLOR = '#e2e8f0'

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
