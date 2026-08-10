'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Map, { Layer, Source, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre'
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
  STATUS_COLORS,
  fillColorByStatus,
  padBounds,
  pinColorByStatus,
} from '@/lib/map-style'
import {
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

type Boundary = { type: 'Feature'; geometry: unknown; properties: object; bbox: number[] }

export default function WardMap({ actorName }: { actorName: string }) {
  const mapRef = useRef<MapRef>(null)
  const [parcels, setParcels] = useState<ParcelCollection>(EMPTY)
  const [boundary, setBoundary] = useState<Boundary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<PanelTarget | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [showCommonAreas, setShowCommonAreas] = useState(false)
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

  // Common areas are hidden by default: roads and retention basins are noise
  // when you are looking for houses.
  const parcelFilter = useMemo(
    () =>
      (showCommonAreas
        ? ['==', ['get', 'kind'], 'parcel']
        : [
            'all',
            ['==', ['get', 'kind'], 'parcel'],
            ['!=', ['get', 'use'], 'common_area'],
          ]) as never,
    [showCommonAreas],
  )
  const pinFilter = useMemo(() => ['==', ['get', 'kind'], 'pin'] as never, [])

  const fillLayer: FillLayerSpecification = {
    id: 'parcel-fill',
    type: 'fill',
    source: 'parcels',
    filter: parcelFilter,
    paint: {
      'fill-color': fillColorByStatus as never,
      'fill-opacity': ['case', ['==', ['get', 'pid'], hovered ?? ''], 0.8, 0.55],
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
        '#111827',
        '#475569',
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
    },
  }

  const labelLayer: SymbolLayerSpecification = {
    id: 'parcel-label',
    type: 'symbol',
    source: 'parcels',
    minzoom: 16,
    filter: parcelFilter,
    layout: {
      // Business name where there is one, otherwise the family name.
      'text-field': ['coalesce', ['get', 'businessName'], ['get', 'familyName'], ''],
      'text-size': 11,
      'text-anchor': 'center',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': ['case', ['==', ['get', 'use'], 'business'], '#713f12', '#0f172a'],
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4,
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
    paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
  }

  const boundaryLayer: LineLayerSpecification = {
    id: 'ward-outline',
    type: 'line',
    source: 'boundary',
    paint: { 'line-color': '#1d4ed8', 'line-width': 2.5, 'line-dasharray': [3, 2] },
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

  const onMouseDown = useCallback(
    (e: MapLayerMouseEvent) => {
      if (!selectMode || !e.originalEvent.shiftKey) return
      e.preventDefault()
      boxStart.current = { x: e.point.x, y: e.point.y }
      setBox({ x1: e.point.x, y1: e.point.y, x2: e.point.x, y2: e.point.y })
    },
    [selectMode],
  )

  const onMouseUp = useCallback(() => {
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
  }, [box])

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
      // Tracing swallows clicks: every one adds a vertex rather than selecting
      // whatever happens to be underneath.
      if (draft) {
        setDraft((d) => [...(d ?? []), [e.lngLat.lng, e.lngLat.lat]])
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
        void addPinAt(e.lngLat.lng, e.lngLat.lat)
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
    [placingPin, addPinAt, draft, selectMode],
  )

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

  const onMouseMove = useCallback((e: MapLayerMouseEvent) => {
    if (boxStart.current) {
      const s = boxStart.current
      setBox({ x1: s.x, y1: s.y, x2: e.point.x, y2: e.point.y })
      return
    }
    const props = e.features?.[0]?.properties
    const id = props?.kind === 'pin' ? props.hid : props?.pid
    setHovered(typeof id === 'string' ? id : null)
  }, [])

  const counts = useMemo(() => {
    const parcelFeatures = parcels.features.filter(
      (f): f is ParcelFeature => f.properties.kind === 'parcel',
    )
    const homes = parcelFeatures.filter((f) => f.properties.use === 'residence').length
    const businesses = parcelFeatures.filter((f) => f.properties.use === 'business').length
    const commonAreas = parcelFeatures.filter((f) => f.properties.use === 'common_area').length
    const pins = parcels.features.length - parcelFeatures.length
    const withHouseholds =
      parcelFeatures.filter((f) => f.properties.householdCount > 0).length + pins
    return { homes, businesses, commonAreas, pins, withHouseholds }
  }, [parcels])

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
        onClick={onClick}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHovered(null)}
        cursor={draft || placingPin || selectMode ? 'crosshair' : hovered ? 'pointer' : 'grab'}
        style={{ width: '100%', height: '100%' }}
      >
        <Source id="parcels" type="geojson" data={parcels}>
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
              paint={{ 'fill-color': '#2563eb', 'fill-opacity': 0.25 }}
            />
            <Layer
              id="draft-line"
              type="line"
              source="draft"
              filter={['!=', ['geometry-type'], 'Point'] as never}
              paint={{ 'line-color': '#2563eb', 'line-width': 2 }}
            />
            <Layer
              id="draft-vertex"
              type="circle"
              source="draft"
              filter={['==', ['geometry-type'], 'Point'] as never}
              paint={{
                'circle-radius': 5,
                'circle-color': '#ffffff',
                'circle-stroke-color': '#2563eb',
                'circle-stroke-width': 2,
              }}
            />
          </Source>
        )}
      </Map>

      {/* Legend + controls */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)]">
        <div className="pointer-events-auto rounded-lg bg-white/95 p-3 text-xs shadow-lg ring-1 ring-black/5 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-sm font-semibold text-neutral-900">Ward Map</h1>
            <button
              type="button"
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' })
                location.href = '/login'
              }}
              className="text-xs text-neutral-500 underline underline-offset-2"
            >
              Sign out
            </button>
          </div>

          <p className="mt-1 text-neutral-500">
            {loading
              ? 'Loading…'
              : `${counts.homes} homes · ${counts.withHouseholds} with a household`}
          </p>

          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <li key={key} className="flex items-center gap-1.5 text-neutral-700">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: STATUS_COLORS[key as keyof typeof STATUS_COLORS] }}
                />
                {label}
              </li>
            ))}
            <li className="flex items-center gap-1.5 text-neutral-700">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: NO_HOUSEHOLD_COLOR }}
              />
              No household
            </li>
            <li className="flex items-center gap-1.5 text-neutral-700">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: BUSINESS_COLOR }}
              />
              Business ({counts.businesses})
            </li>
          </ul>

          <div className="mt-2 space-y-2 border-t border-neutral-200 pt-2">
            <label className="flex items-center gap-2 text-neutral-700">
              <input
                type="checkbox"
                checked={showCommonAreas}
                onChange={(e) => setShowCommonAreas(e.target.checked)}
              />
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: COMMON_AREA_COLOR }}
              />
              Common areas ({counts.commonAreas})
            </label>

            {draft ? (
              <div className="space-y-1.5">
                <p className="text-[11px] text-neutral-600">
                  Click to add corners · {draft.length} point{draft.length === 1 ? '' : 's'}
                  {draft.length < 3 ? ` · ${3 - draft.length} more needed` : ''}
                </p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={saveDraft}
                    disabled={draft.length < 3 || busy}
                    className="flex-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    {busy ? 'Saving…' : 'Save parcel'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft((d) => (d && d.length > 1 ? d.slice(0, -1) : null))}
                    className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-800"
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setPlacingPin(false)
                    setSelected(null)
                    setDraft([])
                  }}
                  className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-800"
                >
                  Draw a parcel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlacingPin(false)
                    setSelected(null)
                    setSelectMode(true)
                  }}
                  className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-800"
                >
                  Select many parcels
                </button>
                <button
                  type="button"
                  onClick={() => setPlacingPin((v) => !v)}
                  aria-pressed={placingPin}
                  className={`w-full rounded-md px-2.5 py-1.5 text-xs font-medium ${
                    placingPin
                      ? 'bg-blue-600 text-white'
                      : 'border border-neutral-300 text-neutral-800'
                  }`}
                >
                  {placingPin ? 'Click the map to place it — Esc to cancel' : 'Drop a pin instead'}
                </button>
              </>
            )}
            {counts.pins > 0 && (
              <p className="text-[11px] text-neutral-500">
                {counts.pins} home{counts.pins === 1 ? '' : 's'} pinned without a parcel
              </p>
            )}
          </div>
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
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center gap-2 border-t border-neutral-200 bg-white/95 px-3 py-2.5 text-xs shadow-lg backdrop-blur sm:right-[26rem] sm:inset-x-auto sm:left-0">
          <span className="font-medium text-neutral-900">
            {picked.length} parcel{picked.length === 1 ? '' : 's'} selected
          </span>
          <span className="hidden text-neutral-500 sm:inline">
            Click to toggle · Shift-drag to box-select
          </span>
          <div className="ml-auto flex items-center gap-2">
            <select
              value=""
              disabled={picked.length === 0 || busy}
              onChange={(e) => {
                const v = e.target.value
                e.currentTarget.value = ''
                if (v) void applyBulk(v as ParcelUse)
              }}
              className="rounded-md border border-neutral-300 px-2 py-1.5 text-xs disabled:opacity-40"
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
              className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-neutral-800 disabled:opacity-40"
            >
              Undo last bulk
            </button>
            <button
              type="button"
              onClick={() => setPicked([])}
              disabled={picked.length === 0}
              className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-neutral-800 disabled:opacity-40"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectMode(false)
                setPicked([])
              }}
              className="rounded-md bg-neutral-900 px-2.5 py-1.5 font-medium text-white"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute bottom-3 left-3 z-30 rounded-md bg-red-600 px-3 py-2 text-xs text-white shadow-lg">
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

/** The id the outline/circle paint expressions compare against, '' when nothing is selected. */
function selectedId(target: PanelTarget | null): string {
  if (!target) return ''
  return target.kind === 'parcel' ? target.parcelId : target.householdId
}
