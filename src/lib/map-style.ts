import type { Map as MapLibreMap, VisibilitySpecification } from 'maplibre-gl'
import type { HouseholdStatus } from './types'

export const MAP_STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty'

/**
 * Esri World Imagery. Free and key-less, which is why it is here rather than
 * Mapbox or MapTiler — this app has no billing account behind it. Attribution is
 * required and rides along on the source, so MapLibre's own attribution control
 * shows it whenever the layer is visible.
 *
 * Imagery over Washington runs out after z19; without maxzoom MapLibre would ask
 * for z20 tiles and get blanks instead of overzooming the z19 ones.
 */
export const SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export const SATELLITE_MAXZOOM = 19
export const SATELLITE_ATTRIBUTION =
  'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community'

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

/** Marked as a business: nobody lives there, so status colouring is meaningless. */
export const BUSINESS_COLOR = '#a16207'

/** Common areas, roads, retention basins — legend key is off by default. */
export const COMMON_AREA_COLOR = '#d6d3d1'

/**
 * Data-driven paint expression. Swapping this on the existing layer is what the
 * "Color by" dropdown will do in Phase 4 — the source is never re-rendered.
 *
 * Use type wins over household status: a business marked by hand should read as
 * a business whether or not somebody once attached a household to it.
 */
export const fillColorByStatus: unknown[] = [
  'case',
  ['==', ['get', 'use'], 'business'],
  BUSINESS_COLOR,
  ['==', ['get', 'use'], 'common_area'],
  COMMON_AREA_COLOR,
  ['==', ['get', 'householdCount'], 0],
  NO_HOUSEHOLD_COLOR,
  [
    'match',
    ['get', 'status'],
    ...Object.entries(STATUS_COLORS).flatMap(([k, v]) => [k, v]),
    STATUS_COLORS.unknown,
  ],
]

/**
 * Which legend key a parcel belongs to.
 *
 * Deliberately the same branch order as fillColorByStatus above: the key you
 * click has to be the one whose colour the parcel is drawn in, or hiding a key
 * would leave parcels of that colour on the map.
 */
export const parcelCategory: unknown[] = [
  'case',
  ['==', ['get', 'use'], 'business'],
  'business',
  ['==', ['get', 'use'], 'common_area'],
  'common_area',
  ['==', ['get', 'householdCount'], 0],
  'no_household',
  ['coalesce', ['get', 'status'], 'unknown'],
]

/**
 * Aerial imagery is not perfectly georeferenced. Esri's capture over this ward
 * sits a couple of metres north of the county's parcel fabric, so on satellite
 * every lot looks shifted south of its house.
 *
 * MapLibre cannot translate a raster layer — there is no `raster-translate` — so
 * the correction moves the ward layers instead, which is the same picture. It is
 * a paint property, so nothing in the database moves: only the drawing does.
 *
 * `*-translate` is in screen pixels, and a fixed pixel offset would be the wrong
 * distance at every zoom but one. A metre is worth twice as many pixels per zoom
 * level, which is exactly what an exponential-base-2 zoom interpolation gives,
 * so two stops describe the whole range.
 */
const NUDGE_LAT_RAD = (FALLBACK_VIEW.latitude * Math.PI) / 180

/**
 * Measured by eye against the county parcels over this ward: Esri's z19 capture
 * sits about four metres north of where the survey puts things. Everyone opening
 * the map gets the corrected view; the control that changes it is tucked away
 * because it should not need touching again unless Esri reflies the area.
 */
export const DEFAULT_IMAGERY_NUDGE = 4

/** Metres per pixel at the ward's latitude, 256 px tiles. */
function metresPerPixel(zoom: number): number {
  return (156543.03392804097 * Math.cos(NUDGE_LAT_RAD)) / 2 ** zoom
}

/**
 * Paint value for the ward layers' `*-translate`.
 *
 * `metres` is how far the imagery appears to sit too far north — the amount the
 * user wants it pushed down. Ward layers move the other way, up the screen,
 * which is negative y.
 */
export function nudgeTranslate(metres: number): unknown {
  if (!metres) return [0, 0]
  // Array outputs inside an expression have to be wrapped: a bare [0, -12] is
  // read as a call to an operator named 0.
  const px = (zoom: number) => ['literal', [0, -metres / metresPerPixel(zoom)]]
  return ['interpolate', ['exponential', 2], ['zoom'], MIN_ZOOM, px(MIN_ZOOM), 22, px(22)]
}

/** Degrees of latitude for a distance in metres — for un-shifting a click. */
export function metresToLatitude(metres: number): number {
  return metres / 111_320
}

/** Parcel outlines have to switch: slate vanishes on a photo, white vanishes on paper. */
export const OUTLINE_COLOR = { map: '#475569', satellite: '#f1f5f9' }

/**
 * Turns the basemap into a satellite hybrid, and hands back the undo.
 *
 * Rather than swapping the whole style — which would tear down and re-add the
 * parcel source with it — this edits the basemap in place:
 *
 *   1. Esri imagery goes in underneath the first road line, so imagery covers the
 *      painted ground but roads, street names and place labels still draw on top.
 *   2. Everything that paints ground (the background, landuse, landcover, water,
 *      building footprints, the shaded-relief raster) is hidden. Left visible
 *      they would be opaque colour over the photo.
 *   3. Kept labels flip to white-on-dark. Liberty's are near-black with a white
 *      halo, which is unreadable over dark imagery, and roads drop to half
 *      opacity so the thing you came to look at is still visible under them.
 *
 * The restore function puts every property it touched back, so toggling is
 * lossless and the parcel layers never move.
 */
export function applySatellite(map: MapLibreMap): () => void {
  const style = map.getStyle()
  const GROUND = new Set(['background', 'fill', 'fill-extrusion', 'raster'])
  /** Previous values of every property touched, for the restore below. */
  const hidden: [string, VisibilitySpecification | undefined][] = []
  type PaintProp = 'text-color' | 'text-halo-color' | 'line-opacity'
  const painted: [string, PaintProp, unknown][] = []

  const firstBasemapLine = style.layers.find((l) => l.type === 'line')?.id

  if (!map.getSource('satellite')) {
    map.addSource('satellite', {
      type: 'raster',
      tiles: [SATELLITE_TILES],
      tileSize: 256,
      maxzoom: SATELLITE_MAXZOOM,
      attribution: SATELLITE_ATTRIBUTION,
    })
  }
  if (!map.getLayer('satellite')) {
    map.addLayer({ id: 'satellite', type: 'raster', source: 'satellite' }, firstBasemapLine)
  }

  // Ward data is not part of the basemap and is never restyled here. The
  // background layer has no source at all, which is easy to skip by accident —
  // and skipping it leaves the basemap's flat paper colour painted over every
  // photo.
  const WARD_SOURCES = new Set(['parcels', 'boundary', 'draft'])

  for (const layer of style.layers) {
    if (layer.id === 'satellite') continue
    if ('source' in layer && WARD_SOURCES.has(layer.source)) continue

    if (GROUND.has(layer.type)) {
      hidden.push([layer.id, map.getLayoutProperty(layer.id, 'visibility')])
      map.setLayoutProperty(layer.id, 'visibility', 'none')
      continue
    }

    if (layer.type === 'symbol') {
      for (const prop of ['text-color', 'text-halo-color'] as const) {
        painted.push([layer.id, prop, map.getPaintProperty(layer.id, prop)])
      }
      map.setPaintProperty(layer.id, 'text-color', '#ffffff')
      map.setPaintProperty(layer.id, 'text-halo-color', 'rgba(0,0,0,0.85)')
      continue
    }

    if (layer.type === 'line') {
      painted.push([layer.id, 'line-opacity', map.getPaintProperty(layer.id, 'line-opacity')])
      map.setPaintProperty(layer.id, 'line-opacity', 0.5)
    }
  }

  return () => {
    if (map.getLayer('satellite')) map.removeLayer('satellite')
    if (map.getSource('satellite')) map.removeSource('satellite')
    for (const [id, value] of hidden) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', value)
    }
    for (const [id, prop, value] of painted) {
      if (map.getLayer(id)) map.setPaintProperty(id, prop, value as never)
    }
  }
}

/** Pinned households (no county parcel) use the same status palette as parcels. */
export const pinColorByStatus: unknown[] = [
  'match',
  ['get', 'status'],
  ...Object.entries(STATUS_COLORS).flatMap(([k, v]) => [k, v]),
  STATUS_COLORS.unknown,
]
