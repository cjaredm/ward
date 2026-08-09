'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Map, { Layer, Source, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import type {
  FillLayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl'
import { FALLBACK_VIEW, MAP_STYLE_URL, STATUS_COLORS, fillColorByStatus } from '@/lib/map-style'
import { STATUS_LABELS, type ParcelCollection } from '@/lib/types'
import ParcelPanel from './ParcelPanel'

const EMPTY: ParcelCollection = { type: 'FeatureCollection', features: [] }

type Boundary = { type: 'Feature'; geometry: unknown; properties: object; bbox: number[] }

export default function WardMap({ actorName }: { actorName: string }) {
  const mapRef = useRef<MapRef>(null)
  const [parcels, setParcels] = useState<ParcelCollection>(EMPTY)
  const [boundary, setBoundary] = useState<Boundary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [showNonResidential, setShowNonResidential] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    const [p, b] = await Promise.allSettled([
      fetch('/api/parcels').then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      ),
      fetch('/api/boundary').then((r) => (r.ok ? r.json() : null)),
    ])
    if (p.status === 'fulfilled') setParcels(p.value as ParcelCollection)
    else setError('Could not load parcels. Reload the page.')
    if (b.status === 'fulfilled' && b.value) setBoundary(b.value as Boundary)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Fit to the ward once the boundary arrives.
  useEffect(() => {
    if (!boundary?.bbox || !mapRef.current) return
    const [w, s, e, n] = boundary.bbox
    mapRef.current.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 40, duration: 0 },
    )
  }, [boundary])

  const parcelFilter = useMemo(
    () => (showNonResidential ? undefined : (['get', 'residential'] as unknown as never)),
    [showNonResidential],
  )

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
      'line-color': ['case', ['==', ['get', 'pid'], selected ?? ''], '#111827', '#64748b'],
      'line-width': ['case', ['==', ['get', 'pid'], selected ?? ''], 3.5, 0.8],
    },
  }

  const labelLayer: SymbolLayerSpecification = {
    id: 'parcel-label',
    type: 'symbol',
    source: 'parcels',
    minzoom: 16,
    filter: parcelFilter,
    layout: {
      'text-field': ['coalesce', ['get', 'familyName'], ''],
      'text-size': 11,
      'text-anchor': 'center',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#0f172a',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4,
    },
  }

  const boundaryLayer: LineLayerSpecification = {
    id: 'ward-outline',
    type: 'line',
    source: 'boundary',
    paint: { 'line-color': '#1d4ed8', 'line-width': 2.5, 'line-dasharray': [3, 2] },
  }

  const onClick = useCallback((e: MapLayerMouseEvent) => {
    const pid = e.features?.[0]?.properties?.pid
    setSelected(typeof pid === 'string' ? pid : null)
  }, [])

  const onMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const pid = e.features?.[0]?.properties?.pid
    setHovered(typeof pid === 'string' ? pid : null)
  }, [])

  const counts = useMemo(() => {
    const total = parcels.features.length
    const residential = parcels.features.filter((f) => f.properties.residential).length
    const withHouseholds = parcels.features.filter((f) => f.properties.householdCount > 0).length
    return { total, residential, nonResidential: total - residential, withHouseholds }
  }, [parcels])

  return (
    <div className="relative h-dvh w-full">
      <Map
        ref={mapRef}
        mapStyle={MAP_STYLE_URL}
        initialViewState={FALLBACK_VIEW}
        interactiveLayerIds={['parcel-fill']}
        onClick={onClick}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHovered(null)}
        cursor={hovered ? 'pointer' : 'grab'}
        style={{ width: '100%', height: '100%' }}
      >
        <Source id="parcels" type="geojson" data={parcels} promoteId={undefined}>
          <Layer {...fillLayer} />
          <Layer {...outlineLayer} />
          <Layer {...labelLayer} />
        </Source>
        {boundary && (
          <Source id="boundary" type="geojson" data={boundary as never}>
            <Layer {...boundaryLayer} />
          </Source>
        )}
      </Map>

      {/* Legend + controls */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)]">
        <div className="pointer-events-auto rounded-lg bg-white/95 p-3 text-xs shadow-lg ring-1 ring-black/5 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-sm font-semibold text-neutral-900">Ward Map</h1>
            <form action="/api/auth/logout" method="post">
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
            </form>
          </div>

          <p className="mt-1 text-neutral-500">
            {loading
              ? 'Loading…'
              : `${counts.residential} homes · ${counts.withHouseholds} with a household`}
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
          </ul>

          <label className="mt-2 flex items-center gap-2 border-t border-neutral-200 pt-2 text-neutral-700">
            <input
              type="checkbox"
              checked={showNonResidential}
              onChange={(e) => setShowNonResidential(e.target.checked)}
            />
            Show non-residential ({counts.nonResidential})
          </label>
        </div>
      </div>

      {error && (
        <div className="absolute bottom-3 left-3 z-10 rounded-md bg-red-600 px-3 py-2 text-xs text-white shadow-lg">
          {error}
        </div>
      )}

      {selected && (
        <ParcelPanel
          parcelId={selected}
          actorName={actorName}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}
