'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Map, {
  GeolocateControl,
  Layer,
  NavigationControl,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  setWorkerUrl,
  type CircleLayerSpecification,
  type FillLayerSpecification,
  type LineLayerSpecification,
  type SymbolLayerSpecification,
} from 'maplibre-gl'
import {
  BUSINESS_COLOR,
  COMMON_AREA_COLOR,
  FALLBACK_VIEW,
  MAP_STYLE_URL,
  MIN_ZOOM,
  NO_HOUSEHOLD_COLOR,
  OUTLINE_COLOR,
  STATUS_COLORS,
  DEFAULT_IMAGERY_NUDGE,
  applySatellite,
  fillColorByStatus,
  metresToLatitude,
  nudgeTranslate,
  padBounds,
  parcelCategory,
  pinColorByStatus,
} from '@/lib/map-style'
import {
  HOUSEHOLD_STATUSES,
  PARCEL_USES,
  STATUS_LABELS,
  USE_LABELS,
  type ParcelCollection,
  type ParcelFeature,
  type ParcelUse,
} from '@/lib/types'
import ParcelPanel, { type PanelTarget } from './ParcelPanel'

/**
 * maplibre-gl v6 loads its worker from a separate file via
 * `new URL('./maplibre-gl-worker.mjs', import.meta.url)`, which Next's bundler
 * does not emit. Left alone the request 404s to an HTML page, the browser
 * rejects it for MIME type, the worker never starts and nothing renders.
 * scripts/copy-maplibre-worker.mjs puts it (and the sibling it imports) in
 * public/ on every dev and build. Runs before the first Map mounts.
 */
setWorkerUrl('/maplibre-gl-worker.mjs')

const EMPTY: ParcelCollection = { type: 'FeatureCollection', features: [] }

/**
 * The legend, top to bottom. Every key is a filter: clicking one shows or hides
 * everything drawn in that colour.
 *
 * Business and common area start hidden. Between them they are half the parcels
 * in the ward and none of them is a home, so leaving them on means hunting for
 * houses through an industrial park and a hundred retention basins.
 */
const LEGEND = [
  ...HOUSEHOLD_STATUSES.map((s) => ({ key: s as string, label: STATUS_LABELS[s], color: STATUS_COLORS[s] })),
  { key: 'no_household', label: 'No household', color: NO_HOUSEHOLD_COLOR },
  { key: 'business', label: 'Business', color: BUSINESS_COLOR },
  { key: 'common_area', label: 'Common area', color: COMMON_AREA_COLOR },
]
const HIDDEN_BY_DEFAULT = ['business', 'common_area']

/**
 * 44px minimum hit area on a phone, back to the compact desktop size at `sm`.
 * These controls are pressed one-handed while walking, so the original
 * 28px-tall buttons were a miss more often than not.
 */
const TAP = 'min-h-11 py-2 sm:min-h-0 sm:py-1.5'

type Boundary = { type: 'Feature'; geometry: unknown; properties: object; bbox: number[] }

export default function WardMap({ actorName }: { actorName: string }) {
  const mapRef = useRef<MapRef>(null)
  const [parcels, setParcels] = useState<ParcelCollection>(EMPTY)
  const [boundary, setBoundary] = useState<Boundary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<PanelTarget | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  /** Legend keys currently switched off. */
  const [hiddenKeys, setHiddenKeys] = useState<string[]>(HIDDEN_BY_DEFAULT)
  const [placingPin, setPlacingPin] = useState(false)
  /** Vertices of the outline being traced, or null when not drawing. */
  const [draft, setDraft] = useState<[number, number][] | null>(null)
  const [busy, setBusy] = useState(false)
  /** Bulk-edit mode: click toggles a parcel, shift-drag box-selects. */
  const [selectMode, setSelectMode] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [box, setBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const boxStart = useRef<{ x: number; y: number } | null>(null)
  /**
   * The pin currently being dragged, at its live (unsaved) position.
   *
   * Mirrored in a ref because the pointer handlers have to branch on "am I
   * dragging?" the instant they fire — a state read there is one render behind.
   */
  const [dragPin, setDragPin] = useState<{ hid: string; lng: number; lat: number } | null>(null)
  const dragPinRef = useRef<{ hid: string; lng: number; lat: number } | null>(null)
  /** Distinguishes a drag from a tap, so releasing a pin does not also open it. */
  const dragMoved = useRef(false)
  /**
   * Legend and tools collapse to a single bar on a phone.
   *
   * Expanded, the card plus an open detail sheet leaves a strip of map perhaps
   * two houses tall. Resolved after mount rather than during render so the
   * server and client markup agree.
   */
  const [controlsOpen, setControlsOpen] = useState(true)
  const [coarse, setCoarse] = useState(false)
  /**
   * Basemap: the drawn map, or aerial imagery with the map's roads and labels
   * still on top. Which one you want depends on the job — imagery to tell which
   * building is which and where the driveways are, the drawn map to read street
   * names at a glance — so the choice is remembered between visits.
   */
  const [satellite, setSatellite] = useState(false)
  /**
   * How far the imagery sits too far north, in metres. Esri's capture here is
   * off by about four, which at a house's scale reads as every lot being drawn
   * south of its roof — so the correction ships on by default and the control
   * for it stays folded away.
   */
  const [nudge, setNudge] = useState(DEFAULT_IMAGERY_NUDGE)
  const [showNudge, setShowNudge] = useState(false)

  useEffect(() => {
    const isCoarse = window.matchMedia('(pointer: coarse)').matches
    setCoarse(isCoarse)
    if (window.matchMedia('(max-width: 639px)').matches) setControlsOpen(false)
    setSatellite(localStorage.getItem('ward:basemap') === 'satellite')
    // Only a value somebody set by hand overrides the measured default.
    const saved = localStorage.getItem('ward:imagery-nudge')
    if (saved !== null && Number.isFinite(Number(saved))) setNudge(Number(saved))
  }, [])

  // Only meaningful over imagery: the drawn basemap is built from the same
  // survey data as the parcels and already lines up.
  const translate = useMemo(
    () => nudgeTranslate(satellite ? nudge : 0) as never,
    [satellite, nudge],
  )

  /**
   * Undoes the nudge on a coordinate the user clicked.
   *
   * The ward layers are drawn `nudge` metres up the screen, so a point stored at
   * the raw click would render that far above the spot aimed at. Everything
   * written from a map click — a dropped pin, a traced outline, a dragged pin —
   * goes through here so that what you point at is what gets saved.
   */
  const unnudge = useCallback(
    (lngLat: { lng: number; lat: number }) =>
      satellite && nudge
        ? { lng: lngLat.lng, lat: lngLat.lat - metresToLatitude(nudge) }
        : { lng: lngLat.lng, lat: lngLat.lat },
    [satellite, nudge],
  )

  // Arming a tool from the collapsed bar has to reveal that tool's own controls.
  // Keyed on "is a tool armed", not on `draft` itself, so collapsing the card
  // mid-trace is not undone by the next vertex.
  const drawing = draft !== null
  useEffect(() => {
    if (drawing || selectMode) setControlsOpen(true)
  }, [drawing, selectMode])

  /**
   * Refreshes parcel data only.
   *
   * Called after every mutation, so it deliberately does NOT touch `boundary`:
   * re-fetching it produced a new object identity, which re-fired the fitBounds
   * effect below and threw the camera back to the whole ward every time the user
   * saved a household.
   *
   * cache: 'no-store' is also load-bearing. /api/parcels sends
   * `private, max-age=30`, and this runs immediately after a write — without it
   * the browser serves its own 30-second-old copy and a just-drawn parcel or
   * just-added household appears to have vanished.
   */
  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/parcels', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      setParcels((await res.json()) as ParcelCollection)
    } catch {
      setError('Could not load parcels. Reload the page.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // The ward boundary is fixed for the life of the page, so it is fetched once.
  useEffect(() => {
    let cancelled = false
    fetch('/api/boundary', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!cancelled && b) setBoundary(b as Boundary)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Frame the ward once, when the boundary first arrives. Guarded by a ref so a
  // re-render can never yank the camera out from under someone mid-edit.
  const framed = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!boundary?.bbox || !map || framed.current) return
    framed.current = true
    const [w, s, e, n] = boundary.bbox
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 40, duration: 0 },
    )
  }, [boundary])

  const maxBounds = useMemo(
    () => (boundary?.bbox ? padBounds(boundary.bbox) : undefined),
    [boundary],
  )

  /**
   * Satellite is applied to the live style rather than by swapping styles:
   * setStyle would tear the parcel source down and rebuild it, which flashes the
   * whole ward and drops the selection. The cleanup puts the basemap back.
   */
  const [mapLoaded, setMapLoaded] = useState(false)
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !mapLoaded || !satellite) return
    return applySatellite(map)
  }, [satellite, mapLoaded])

  // Escape backs out of whatever mode is armed, innermost first, and only closes
  // the panel once nothing else is pending. Without this, arming a tool and
  // changing your mind means clicking the map and creating something unwanted.
  // Backspace removes the last point placed while tracing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (picked.length) setPicked([])
        else if (selectMode) setSelectMode(false)
        else if (draft) setDraft(null)
        else if (placingPin) setPlacingPin(false)
        else setSelected(null)
        return
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && draft) {
        e.preventDefault()
        setDraft((d) => (d && d.length > 1 ? d.slice(0, -1) : null))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placingPin, draft, selectMode, picked.length])

  const visibleKeys = useMemo(
    () => LEGEND.map((l) => l.key).filter((k) => !hiddenKeys.includes(k)),
    [hiddenKeys],
  )

  const parcelFilter = useMemo(
    () =>
      ['all', ['==', ['get', 'kind'], 'parcel'], ['in', parcelCategory, ['literal', visibleKeys]]] as never,
    [visibleKeys],
  )

  // A pin is a household with no parcel, so it answers to its status key and to
  // nothing else — hiding "Business" must not take pinned homes with it.
  const pinFilter = useMemo(
    () =>
      [
        'all',
        ['==', ['get', 'kind'], 'pin'],
        ['in', ['coalesce', ['get', 'status'], 'unknown'], ['literal', visibleKeys]],
      ] as never,
    [visibleKeys],
  )

  const fillLayer: FillLayerSpecification = {
    id: 'parcel-fill',
    type: 'fill',
    source: 'parcels',
    filter: parcelFilter,
    paint: {
      'fill-color': fillColorByStatus as never,
      'fill-opacity': ['case', ['==', ['get', 'pid'], hovered ?? ''], 0.8, 0.55],
      'fill-translate': translate,
    },
  }

  const outlineLayer: LineLayerSpecification = {
    id: 'parcel-outline',
    type: 'line',
    source: 'parcels',
    filter: parcelFilter,
    paint: {
      'line-color': [
        'case',
        ['in', ['get', 'pid'], ['literal', picked]],
        '#2563eb',
        ['==', ['get', 'pid'], selectedId(selected)],
        satellite ? '#ffffff' : '#111827',
        satellite ? OUTLINE_COLOR.satellite : OUTLINE_COLOR.map,
      ],
      'line-width': [
        'case',
        ['in', ['get', 'pid'], ['literal', picked]],
        3,
        ['==', ['get', 'pid'], selectedId(selected)],
        3.5,
        1.1,
      ],
      // Hand-drawn parcels read as approximate, because they are.
      'line-dasharray': [
        'case',
        ['==', ['get', 'source'], 'manual'],
        ['literal', [2, 1.5]],
        ['literal', [1, 0]],
      ],
      'line-translate': translate,
    },
  }

  const labelLayer: SymbolLayerSpecification = {
    id: 'parcel-label',
    type: 'symbol',
    source: 'parcels',
    minzoom: 16,
    filter: parcelFilter,
    layout: {
      // Business name where there is one, otherwise the family name. A unit with
      // several tenants prints the first and a count — six names would cover the
      // block, and the panel lists them all anyway.
      'text-field': [
        'case',
        ['>', ['coalesce', ['get', 'businessCount'], 0], 1],
        [
          'concat',
          ['get', 'businessName'],
          '  +',
          ['to-string', ['-', ['get', 'businessCount'], 1]],
        ],
        ['coalesce', ['get', 'businessName'], ['get', 'familyName'], ''],
      ],
      'text-size': 11,
      'text-anchor': 'center',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': ['case', ['==', ['get', 'use'], 'business'], '#713f12', '#0f172a'],
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4,
      'text-translate': translate,
    },
  }

  // Households with no county parcel behind them.
  const pinLayer: CircleLayerSpecification = {
    id: 'pin-circle',
    type: 'circle',
    source: 'parcels',
    filter: pinFilter,
    paint: {
      'circle-radius': ['case', ['==', ['get', 'hid'], selectedId(selected)], 11, 8],
      'circle-color': pinColorByStatus as never,
      'circle-stroke-width': ['case', ['==', ['get', 'hid'], selectedId(selected)], 3, 2],
      'circle-stroke-color': '#111827',
      'circle-translate': translate,
    },
  }

  const pinLabelLayer: SymbolLayerSpecification = {
    id: 'pin-label',
    type: 'symbol',
    source: 'parcels',
    minzoom: 16,
    filter: pinFilter,
    layout: {
      'text-field': ['get', 'familyName'],
      'text-size': 11,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#0f172a',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4,
      'text-translate': translate,
    },
  }

  const boundaryLayer: LineLayerSpecification = {
    id: 'ward-outline',
    type: 'line',
    source: 'boundary',
    paint: {
      'line-color': '#1d4ed8',
      'line-width': 2.5,
      'line-dasharray': [3, 2],
      'line-translate': translate,
    },
  }

  const addPinAt = useCallback(
    async (lng: number, lat: number) => {
      setPlacingPin(false)
      const res = await fetch('/api/households', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lng, lat, family_name: 'New household' }),
      })
      if (!res.ok) {
        setError('Could not add a home there. Try again.')
        return
      }
      const { id } = (await res.json()) as { id: string }
      await load()
      setSelected({ kind: 'pin', householdId: id })
    },
    [load],
  )

  const saveDraft = useCallback(async () => {
    if (!draft || draft.length < 3) return
    setBusy(true)
    try {
      const res = await fetch('/api/parcels/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ring: draft }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'Could not save that outline.')
        return
      }
      const { parcel_id } = (await res.json()) as { parcel_id: string }
      setDraft(null)
      await load()
      setSelected({ kind: 'parcel', parcelId: parcel_id })
    } finally {
      setBusy(false)
    }
  }, [draft, load])

  /**
   * Shift-drag box select.
   *
   * MapLibre binds shift-drag to box *zoom*, so that handler is disabled while
   * this mode is on, otherwise dragging a selection would fly the camera instead.
   */
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    if (selectMode) map.boxZoom.disable()
    else map.boxZoom.enable()
  }, [selectMode])

  /**
   * Pin dragging.
   *
   * The directory import drops a pin for every household the county has no parcel
   * for, and the ones it cannot place at all land in a cluster in the middle of
   * the ward. Without a way to move them the only fix is delete-and-re-drop,
   * which throws away the names and phone numbers already on the household.
   *
   * MapLibre has no draggable feature, so this is the manual version: grab on
   * pointer-down over the pin layer, follow the pointer with dragPan turned off,
   * save on release.
   */
  const startPinDrag = useCallback(
    (
      point: { x: number; y: number },
      lngLat: { lng: number; lat: number },
      /**
       * Half-width of the hit box, in px. A fingertip covers far more than the
       * 8px pin it is aiming at, so touch queries a box and the mouse an exact
       * point — a box for the mouse would grab pins the user meant to pan past.
       */
      slop = 0,
    ): boolean => {
      if (selectMode || draft || placingPin) return false
      const map = mapRef.current?.getMap()
      // queryRenderedFeatures rather than e.features: this has to be exact, and
      // pointer-down is not one of the events react-map-gl reliably enriches.
      const at: [number, number] | [[number, number], [number, number]] = slop
        ? [
            [point.x - slop, point.y - slop],
            [point.x + slop, point.y + slop],
          ]
        : [point.x, point.y]
      const hit = map?.queryRenderedFeatures(at, { layers: ['pin-circle'] })?.[0]
      const hid = hit?.properties?.hid
      if (typeof hid !== 'string') return false

      map?.dragPan.disable()
      dragMoved.current = false
      const start = unnudge(lngLat)
      dragPinRef.current = { hid, lng: start.lng, lat: start.lat }
      setDragPin(dragPinRef.current)
      return true
    },
    [selectMode, draft, placingPin, unnudge],
  )

  const movePinDrag = useCallback((lngLat: { lng: number; lat: number }): boolean => {
    const pin = dragPinRef.current
    if (!pin) return false
    dragMoved.current = true
    const at = unnudge(lngLat)
    dragPinRef.current = { ...pin, lng: at.lng, lat: at.lat }
    setDragPin(dragPinRef.current)
    return true
  }, [unnudge])

  const endPinDrag = useCallback(async (): Promise<boolean> => {
    const pin = dragPinRef.current
    if (!pin) return false
    dragPinRef.current = null
    mapRef.current?.getMap()?.dragPan.enable()
    setDragPin(null)
    if (!dragMoved.current) return true

    const res = await fetch(`/api/households/${encodeURIComponent(pin.hid)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lng: pin.lng, lat: pin.lat }),
    })
    if (!res.ok) setError('Could not move that pin. Reload and try again.')
    // Reload either way: on failure this snaps the pin back to where it really is.
    await load()
    return true
  }, [load])

  const onMouseDown = useCallback(
    (e: MapLayerMouseEvent) => {
      if (startPinDrag(e.point, e.lngLat)) {
        e.preventDefault()
        return
      }
      if (!selectMode || !e.originalEvent.shiftKey) return
      e.preventDefault()
      boxStart.current = { x: e.point.x, y: e.point.y }
      setBox({ x1: e.point.x, y1: e.point.y, x2: e.point.x, y2: e.point.y })
    },
    [selectMode, startPinDrag],
  )

  const onMouseUp = useCallback(() => {
    if (dragPinRef.current) {
      void endPinDrag()
      return
    }
    const start = boxStart.current
    boxStart.current = null
    if (!start || !box) {
      setBox(null)
      return
    }
    const map = mapRef.current?.getMap()
    if (map) {
      const hits = map.queryRenderedFeatures(
        [
          [Math.min(box.x1, box.x2), Math.min(box.y1, box.y2)],
          [Math.max(box.x1, box.x2), Math.max(box.y1, box.y2)],
        ],
        { layers: ['parcel-fill'] },
      )
      const pids = hits
        .map((f) => f.properties?.pid)
        .filter((v): v is string => typeof v === 'string')
      setPicked((prev) => Array.from(new Set([...prev, ...pids])))
    }
    setBox(null)
  }, [box, endPinDrag])

  const applyBulk = useCallback(
    async (use_type: ParcelUse) => {
      if (picked.length === 0) return
      setBusy(true)
      try {
        const res = await fetch('/api/parcels/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parcel_ids: picked, use_type }),
        })
        if (!res.ok) {
          setError('Could not update those parcels.')
          return
        }
        setPicked([])
        await load()
      } finally {
        setBusy(false)
      }
    },
    [picked, load],
  )

  const undoBulk = useCallback(async () => {
    if (!confirm('Undo the most recent bulk change? Those parcels go back to how they were.')) return
    setBusy(true)
    try {
      const res = await fetch('/api/parcels/bulk/undo', { method: 'POST' })
      const body = (await res.json().catch(() => null)) as
        | { restored?: number; error?: string }
        | null
      if (!res.ok) {
        setError(body?.error ?? 'Could not undo.')
        return
      }
      setPicked([])
      await load()
      setError(`Restored ${body?.restored ?? 0} parcels.`)
      setTimeout(() => setError(null), 6000)
    } finally {
      setBusy(false)
    }
  }, [load])

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      // A pin that was just dragged also emits a click on release. Opening the
      // panel there would cover the house the user was aiming at.
      if (dragMoved.current) {
        dragMoved.current = false
        return
      }
      // Tracing swallows clicks: every one adds a vertex rather than selecting
      // whatever happens to be underneath.
      if (draft) {
        const at = unnudge(e.lngLat)
        setDraft((d) => [...(d ?? []), [at.lng, at.lat]])
        return
      }
      // In bulk mode a click toggles membership instead of opening the panel.
      if (selectMode) {
        const pid = e.features?.[0]?.properties?.pid
        if (typeof pid !== 'string') return
        setPicked((prev) => (prev.includes(pid) ? prev.filter((p) => p !== pid) : [...prev, pid]))
        return
      }
      if (placingPin) {
        const at = unnudge(e.lngLat)
        void addPinAt(at.lng, at.lat)
        return
      }
      const props = e.features?.[0]?.properties
      if (props?.kind === 'pin' && typeof props.hid === 'string') {
        setSelected({ kind: 'pin', householdId: props.hid })
      } else if (props?.kind === 'parcel' && typeof props.pid === 'string') {
        setSelected({ kind: 'parcel', parcelId: props.pid })
      } else {
        setSelected(null)
      }
    },
    [placingPin, addPinAt, draft, selectMode, unnudge],
  )

  /**
   * What the map actually renders: the fetched collection, with the pin being
   * dragged moved to the pointer. The saved position only changes on release.
   */
  const mapData = useMemo(() => {
    if (!dragPin) return parcels
    return {
      ...parcels,
      features: parcels.features.map((f) =>
        f.properties.kind === 'pin' && f.properties.hid === dragPin.hid
          ? { ...f, geometry: { type: 'Point' as const, coordinates: [dragPin.lng, dragPin.lat] } }
          : f,
      ),
    } as ParcelCollection
  }, [parcels, dragPin])

  /** The outline being traced: filled area once it can close, plus the vertices. */
  const draftData = useMemo(() => {
    if (!draft || draft.length === 0) return null
    const features: object[] = draft.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: c },
      properties: {},
    }))
    if (draft.length >= 3) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[...draft, draft[0]]] },
        properties: {},
      })
    } else if (draft.length === 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: draft },
        properties: {},
      })
    }
    return { type: 'FeatureCollection', features }
  }, [draft])

  const onMouseMove = useCallback(
    (e: MapLayerMouseEvent) => {
      if (movePinDrag(e.lngLat)) return
      if (boxStart.current) {
        const s = boxStart.current
        setBox({ x1: s.x, y1: s.y, x2: e.point.x, y2: e.point.y })
        return
      }
      // Touch browsers synthesise one mousemove on tap, which would leave a
      // parcel highlighted with nothing under the finger.
      if (coarse) return
      const props = e.features?.[0]?.properties
      const id = props?.kind === 'pin' ? props.hid : props?.pid
      setHovered(typeof id === 'string' ? id : null)
    },
    [movePinDrag, coarse],
  )

  const counts = useMemo(() => {
    const parcelFeatures = parcels.features.filter(
      (f): f is ParcelFeature => f.properties.kind === 'parcel',
    )
    const homes = parcelFeatures.filter((f) => f.properties.use === 'residence').length
    const pins = parcels.features.length - parcelFeatures.length
    const withHouseholds =
      parcelFeatures.filter((f) => f.properties.householdCount > 0).length + pins

    // Per legend key, by the same rule the map colours and filters by.
    const byKey: Record<string, number> = {}
    const bump = (k: string) => (byKey[k] = (byKey[k] ?? 0) + 1)
    for (const f of parcels.features) {
      if (f.properties.kind === 'pin') {
        bump(f.properties.status ?? 'unknown')
        continue
      }
      const p = f.properties
      if (p.use === 'business') bump('business')
      else if (p.use === 'common_area') bump('common_area')
      else if (p.householdCount === 0) bump('no_household')
      else bump(p.status ?? 'unknown')
    }
    return { homes, pins, withHouseholds, byKey }
  }, [parcels])

  const toggleKey = useCallback((key: string) => {
    setHiddenKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }, [])

  return (
    <div className="relative h-dvh w-full">
      <Map
        ref={mapRef}
        mapStyle={MAP_STYLE_URL}
        initialViewState={FALLBACK_VIEW}
        minZoom={MIN_ZOOM}
        maxZoom={19}
        maxBounds={maxBounds}
        interactiveLayerIds={['parcel-fill', 'pin-circle']}
        onLoad={() => setMapLoaded(true)}
        onClick={onClick}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHovered(null)}
        // Touch mirrors mouse so a pin can be dragged onto its house on a phone,
        // which is where this app is used.
        onTouchStart={(e) => startPinDrag(e.point, e.lngLat, 14)}
        onTouchMove={(e) => movePinDrag(e.lngLat)}
        onTouchEnd={() => void endPinDrag()}
        onTouchCancel={() => void endPinDrag()}
        cursor={
          dragPin
            ? 'grabbing'
            : draft || placingPin || selectMode
              ? 'crosshair'
              : hovered
                ? 'pointer'
                : 'grab'
        }
        style={{ width: '100%', height: '100%' }}
      >
        {/*
          Top-right: the legend owns the top-left and the detail sheet covers the
          whole bottom of a phone screen, so it is the only corner that is never
          buried. Geolocation is what makes this usable in the field — standing
          on a street, "which of these is 1247?" is answered by the blue dot.
        */}
        <GeolocateControl
          position="top-right"
          positionOptions={{ enableHighAccuracy: true }}
          trackUserLocation
          showAccuracyCircle
        />
        <NavigationControl position="top-right" showCompass={false} visualizePitch={false} />

        <Source id="parcels" type="geojson" data={mapData}>
          <Layer {...fillLayer} />
          <Layer {...outlineLayer} />
          <Layer {...labelLayer} />
          <Layer {...pinLayer} />
          <Layer {...pinLabelLayer} />
        </Source>
        {boundary && (
          <Source id="boundary" type="geojson" data={boundary as never}>
            <Layer {...boundaryLayer} />
          </Source>
        )}
        {draftData && (
          <Source id="draft" type="geojson" data={draftData as never}>
            <Layer
              id="draft-fill"
              type="fill"
              source="draft"
              filter={['==', ['geometry-type'], 'Polygon'] as never}
              paint={{ 'fill-color': '#2563eb', 'fill-opacity': 0.25, 'fill-translate': translate }}
            />
            <Layer
              id="draft-line"
              type="line"
              source="draft"
              filter={['!=', ['geometry-type'], 'Point'] as never}
              paint={{ 'line-color': '#2563eb', 'line-width': 2, 'line-translate': translate }}
            />
            <Layer
              id="draft-vertex"
              type="circle"
              source="draft"
              filter={['==', ['geometry-type'], 'Point'] as never}
              // Vertices are stored un-nudged, so they need the same shift as
              // the parcels to sit back under the finger that placed them.
              paint={{
                'circle-radius': 5,
                'circle-color': '#ffffff',
                'circle-stroke-color': '#2563eb',
                'circle-stroke-width': 2,
                'circle-translate': translate,
              }}
            />
          </Source>
        )}
      </Map>

      {/* Legend + controls */}
      <div
        className="pointer-events-none absolute z-10 w-[min(20rem,calc(100vw-5.5rem))]"
        style={{
          left: 'max(0.75rem, env(safe-area-inset-left))',
          top: 'max(0.75rem, env(safe-area-inset-top))',
        }}
      >
        <div className="pointer-events-auto rounded-lg bg-white/95 p-3 text-xs shadow-lg ring-1 ring-black/5 backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-sm font-semibold text-neutral-900">Ward Map</h1>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={async () => {
                  await fetch('/api/auth/logout', { method: 'POST' })
                  location.href = '/login'
                }}
                className="rounded px-1.5 py-1 text-xs text-neutral-500 underline underline-offset-2"
              >
                Sign out
              </button>
              {/*
                Collapsed, this card is one line instead of two thirds of a
                phone screen. Expanded is still the default on a laptop.
              */}
              <button
                type="button"
                onClick={() => setControlsOpen((v) => !v)}
                aria-expanded={controlsOpen}
                aria-label={controlsOpen ? 'Hide legend and tools' : 'Show legend and tools'}
                className="-mr-1 flex h-8 w-8 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100"
              >
                <span aria-hidden className={controlsOpen ? '' : 'rotate-180'}>
                  ▲
                </span>
              </button>
            </div>
          </div>

          <p className="mt-1 text-neutral-500">
            {loading
              ? 'Loading…'
              : `${counts.homes} homes · ${counts.withHouseholds} with a household`}
          </p>

          {/* Always visible, collapsed card included: this is the control most
              likely to be wanted while standing in front of a house. */}
          <div className="mt-2 flex rounded-md bg-neutral-100 p-0.5">
            {(
              [
                ['Map', false],
                ['Satellite', true],
              ] as const
            ).map(([label, on]) => (
              <button
                key={label}
                type="button"
                aria-pressed={satellite === on}
                onClick={() => {
                  setSatellite(on)
                  localStorage.setItem('ward:basemap', on ? 'satellite' : 'map')
                }}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium ${
                  satellite === on ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {controlsOpen && (
            <>
              {/* The legend is the filter. Each key toggles everything drawn in
                  that colour, so "where are the less-active families?" is one
                  tap rather than a squint across a full map. */}
              <ul className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5">
                {LEGEND.map(({ key, label, color }) => {
                  const on = !hiddenKeys.includes(key)
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => toggleKey(key)}
                        aria-pressed={on}
                        title={on ? `Hide ${label}` : `Show ${label}`}
                        className={`flex w-full items-center gap-1.5 rounded px-1 py-1.5 text-left hover:bg-neutral-100 sm:py-1 ${
                          on ? 'text-neutral-700' : 'text-neutral-400'
                        }`}
                      >
                        <span
                          aria-hidden
                          className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-inset ring-black/10"
                          // A hidden key keeps its swatch outline but loses the
                          // fill, so the row reads as "off" rather than as a
                          // colour nobody chose.
                          style={{ background: on ? color : 'transparent' }}
                        />
                        <span className={`truncate ${on ? '' : 'line-through'}`}>{label}</span>
                        <span className="ml-auto shrink-0 tabular-nums text-[10px] text-neutral-400">
                          {counts.byKey[key] ?? 0}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>

              {hiddenKeys.length > 0 && (
                <button
                  type="button"
                  onClick={() => setHiddenKeys([])}
                  className="mt-1 px-1 text-[11px] text-neutral-500 underline underline-offset-2"
                >
                  Show all {hiddenKeys.length} hidden
                </button>
              )}

              <div className="mt-2 space-y-2 border-t border-neutral-200 pt-2">
                {draft ? (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-neutral-600">
                      {coarse ? 'Tap to add corners' : 'Click to add corners'} · {draft.length} point
                      {draft.length === 1 ? '' : 's'}
                      {draft.length < 3 ? ` · ${3 - draft.length} more needed` : ''}
                    </p>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={saveDraft}
                        disabled={draft.length < 3 || busy}
                        className={`flex-1 rounded-md bg-blue-600 px-2.5 text-xs font-medium text-white disabled:opacity-40 ${TAP}`}
                      >
                        {busy ? 'Saving…' : 'Save parcel'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraft((d) => (d && d.length > 1 ? d.slice(0, -1) : null))}
                        className={`rounded-md border border-neutral-300 px-2.5 text-xs text-neutral-800 ${TAP}`}
                      >
                        Undo
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraft(null)}
                        className={`rounded-md border border-neutral-300 px-2.5 text-xs text-neutral-800 ${TAP}`}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* One row of icons rather than three full-width buttons:
                        these are used perhaps once a session, and stacked they
                        cost more of a phone screen than the legend does. */}
                    <div className="flex gap-1.5">
                      <ToolButton
                        label="Draw a parcel"
                        hint="Trace an outline for a home the county has no parcel for"
                        align="left"
                        onClick={() => {
                          setPlacingPin(false)
                          setSelected(null)
                          setDraft([])
                        }}
                        // A lot with corner handles. A regular pentagon read as
                        // a star at 20px, which is not a thing this app has.
                        icon={
                          <>
                            <path d="M5 6.5 18.5 5l1.5 12.5L6.5 19z" />
                            <circle cx="5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
                            <circle cx="18.5" cy="5" r="1.5" fill="currentColor" stroke="none" />
                            <circle cx="20" cy="17.5" r="1.5" fill="currentColor" stroke="none" />
                            <circle cx="6.5" cy="19" r="1.5" fill="currentColor" stroke="none" />
                          </>
                        }
                      />
                      <ToolButton
                        label="Select many parcels"
                        hint="Set the property type on a whole street at once"
                        align="center"
                        onClick={() => {
                          setPlacingPin(false)
                          setSelected(null)
                          setSelectMode(true)
                        }}
                        icon={
                          <>
                            <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" strokeDasharray="3 2.5" />
                            <path d="M8 12.4l2.6 2.6L16.5 9" />
                          </>
                        }
                      />
                      <ToolButton
                        label="Drop a pin"
                        hint="Mark a home that has no parcel to click on"
                        align="right"
                        pressed={placingPin}
                        onClick={() => setPlacingPin((v) => !v)}
                        icon={
                          <>
                            <path d="M12 21s6.5-6.1 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 14.9 12 21 12 21z" />
                            <circle cx="12" cy="10.5" r="2.4" />
                          </>
                        }
                      />
                    </div>
                    {/* An armed tool has to say so somewhere a tooltip cannot:
                        the finger that pressed it is already off the button. */}
                    {placingPin && (
                      <p className="text-[11px] text-blue-700">
                        {coarse
                          ? 'Tap the map to place it'
                          : 'Click the map to place it — Esc to cancel'}
                      </p>
                    )}
                    {/* Esc is the desktop way out; a phone needs a visible one. */}
                    {placingPin && coarse && (
                      <button
                        type="button"
                        onClick={() => setPlacingPin(false)}
                        className={`w-full rounded-md border border-neutral-300 px-2.5 text-xs text-neutral-800 ${TAP}`}
                      >
                        Cancel
                      </button>
                    )}
                  </>
                )}
                {counts.pins > 0 && (
                  <p className="text-[11px] text-neutral-500">
                    {counts.pins} home{counts.pins === 1 ? '' : 's'} pinned without a parcel
                  </p>
                )}
              </div>

              {/*
                Imagery alignment.
                Esri's capture sits about four metres north of the county survey
                here, so the correction is on by default and this is only the
                escape hatch for the day that stops being true. Folded away: it
                is a one-time calibration, not a thing to fiddle with in the
                field, and it moves nothing in the database.
              */}
              {satellite && (
                <div className="mt-2 border-t border-neutral-200 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowNudge((v) => !v)}
                    aria-expanded={showNudge}
                    className="text-[11px] text-neutral-400 underline underline-offset-2"
                  >
                    Imagery alignment
                  </button>

                  {showNudge && (
                    <div className="mt-1.5 flex items-center gap-1 text-[11px] text-neutral-600">
                      <span className="mr-auto">Nudge photo</span>
                      {(
                        [
                          ['↑', -1, 'Move imagery up'],
                          ['↓', 1, 'Move imagery down'],
                        ] as const
                      ).map(([glyph, step, title]) => (
                        <button
                          key={glyph}
                          type="button"
                          title={title}
                          aria-label={title}
                          onClick={() => {
                            // Whole metres, and never a runaway: past ~15 m the
                            // imagery is a different street, not a misalignment.
                            const next = Math.max(-15, Math.min(15, nudge + step))
                            setNudge(next)
                            localStorage.setItem('ward:imagery-nudge', String(next))
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded border border-neutral-300 text-neutral-800"
                        >
                          {glyph}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setNudge(DEFAULT_IMAGERY_NUDGE)
                          localStorage.removeItem('ward:imagery-nudge')
                        }}
                        disabled={nudge === DEFAULT_IMAGERY_NUDGE}
                        className="w-12 text-right tabular-nums text-neutral-500 underline underline-offset-2 disabled:no-underline"
                        title={
                          nudge === DEFAULT_IMAGERY_NUDGE
                            ? 'The measured default'
                            : `Reset to ${DEFAULT_IMAGERY_NUDGE} m`
                        }
                      >
                        {nudge > 0 ? `+${nudge}` : nudge} m
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Drag rectangle, drawn in screen space over the canvas. */}
      {box && (
        <div
          className="pointer-events-none absolute z-10 border-2 border-blue-600 bg-blue-500/20"
          style={{
            left: Math.min(box.x1, box.x2),
            top: Math.min(box.y1, box.y2),
            width: Math.abs(box.x2 - box.x1),
            height: Math.abs(box.y2 - box.y1),
          }}
        />
      )}

      {/* Bulk action bar */}
      {selectMode && (
        <div
          className="absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center gap-2 border-t border-neutral-200 bg-white/95 px-3 py-2.5 text-xs shadow-lg backdrop-blur sm:right-[26rem] sm:inset-x-auto sm:left-0"
          style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
        >
          <span className="font-medium text-neutral-900">
            {picked.length} parcel{picked.length === 1 ? '' : 's'} selected
          </span>
          {/* Shift-drag has no touch equivalent, so a phone gets the tap-only rule. */}
          <span className="text-neutral-500">
            {coarse ? 'Tap parcels to add or remove' : 'Click to toggle · Shift-drag to box-select'}
          </span>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <select
              value=""
              disabled={picked.length === 0 || busy}
              onChange={(e) => {
                const v = e.target.value
                e.currentTarget.value = ''
                if (v) void applyBulk(v as ParcelUse)
              }}
              className={`rounded-md border border-neutral-300 px-2 text-xs disabled:opacity-40 ${TAP}`}
            >
              <option value="">Set type to…</option>
              {PARCEL_USES.map((u) => (
                <option key={u} value={u}>
                  {USE_LABELS[u]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={undoBulk}
              disabled={busy}
              title="Restore the parcels changed by the last bulk update"
              className={`rounded-md border border-neutral-300 px-2.5 text-neutral-800 disabled:opacity-40 ${TAP}`}
            >
              Undo last bulk
            </button>
            <button
              type="button"
              onClick={() => setPicked([])}
              disabled={picked.length === 0}
              className={`rounded-md border border-neutral-300 px-2.5 text-neutral-800 disabled:opacity-40 ${TAP}`}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectMode(false)
                setPicked([])
              }}
              className={`rounded-md bg-neutral-900 px-2.5 font-medium text-white ${TAP}`}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          className="absolute inset-x-3 z-30 rounded-md bg-red-600 px-3 py-2 text-xs text-white shadow-lg sm:inset-x-auto sm:left-3"
          style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          {error}
        </div>
      )}

      {selected && (
        <ParcelPanel
          target={selected}
          actorName={actorName}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}

/**
 * One map tool, as an icon.
 *
 * The label is not decoration that got dropped — it is the accessible name and
 * the tooltip, so the button is still legible to a screen reader and to anyone
 * who cannot guess a pictogram. The tooltip opens on focus as well as hover,
 * which is what makes it reachable by keyboard and by a first tap on a phone,
 * where hover does not exist.
 */
function ToolButton({
  label,
  hint,
  icon,
  align,
  pressed = false,
  onClick,
}: {
  label: string
  hint: string
  icon: React.ReactNode
  /**
   * Which edge the tooltip hangs from. The card is barely wider than three
   * tooltips, so a centred one under the first or last button runs off the side
   * of a phone.
   */
  align: 'left' | 'center' | 'right'
  pressed?: boolean
  onClick: () => void
}) {
  const anchor = {
    left: 'left-0',
    center: 'left-1/2 -translate-x-1/2',
    right: 'right-0',
  }[align]
  return (
    <div className="group relative flex-1">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={pressed}
        aria-label={`${label}. ${hint}`}
        // Native tooltip as well: it survives a long hover without the card
        // having to stay open, and costs nothing.
        title={`${label} — ${hint}`}
        className={`flex min-h-11 w-full items-center justify-center rounded-md sm:min-h-9 ${
          pressed
            ? 'bg-blue-600 text-white'
            : 'border border-neutral-300 text-neutral-700 hover:bg-neutral-100'
        }`}
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icon}
        </svg>
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-30 mt-1 hidden w-44 rounded-md bg-neutral-900 px-2 py-1.5 text-[11px] leading-snug text-white shadow-lg group-hover:block group-focus-within:block ${anchor}`}
      >
        <span className="font-medium">{label}</span>
        <span className="text-neutral-300"> — {hint}</span>
      </span>
    </div>
  )
}

/** The id the outline/circle paint expressions compare against, '' when nothing is selected. */
function selectedId(target: PanelTarget | null): string {
  if (!target) return ''
  return target.kind === 'parcel' ? target.parcelId : target.householdId
}
