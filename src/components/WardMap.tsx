'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Map, {
  GeolocateControl,
  Layer,
  NavigationControl,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import './ward-map-print.css'
import {
  setWorkerUrl,
  type CircleLayerSpecification,
  type FillLayerSpecification,
  type LineLayerSpecification,
  type Map as MapLibreMap,
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
  type MapGroup,
  type MapGroupMember,
  type ParcelCollection,
  type ParcelFeature,
  type ParcelUse,
  type PinFeature,
} from '@/lib/types'
import { orgInk, orgTint } from '@/lib/orgs'
import Clamped from './Clamped'
import ToolButton from './ToolButton'
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

/**
 * Printing, in inches of letter paper.
 *
 * Landscape at a 0.4in margin leaves 10.2 x 7.7in, and the masthead and legend
 * take about 1.2 of the 7.7 between them. What is left is the map's box, and
 * `PRINT_ASPECT` is the shape the on-screen canvas is resized to before the
 * print so that the picture is never stretched onto it.
 */
const PAGE_W_IN = 10.2
const MAP_MAX_H_IN = 7.7 - 1.2
const PRINT_ASPECT = PAGE_W_IN / MAP_MAX_H_IN
/**
 * How wide the canvas is rendered for a print, in CSS pixels.
 *
 * A print is rasterised from whatever the WebGL canvas holds, so its width is
 * the resolution of the printed map: 1800px across 10.2in is about 175 dpi,
 * which is a readable street map. Higher costs a longer wait for tiles.
 */
const PRINT_PX_W = 1800

type Boundary = { type: 'Feature'; geometry: unknown; properties: object; bbox: number[] }

/** One home in the highlighted group, as the member list beside the map shows it. */
type GroupHome = {
  householdId: string
  familyName: string
  /** What clicking the row opens, or null when this home is not on the map at all. */
  target: PanelTarget | null
  people: { personId: string; name: string; callings: string[]; via: MapGroupMember['via'] }[]
}

export default function WardMap({
  actorName,
  initialGroupKey = null,
}: {
  actorName: string
  /**
   * An organization to open highlighted, from the org chart's per-block link.
   * The camera frames it once its members have loaded — see `framedInitial`.
   */
  initialGroupKey?: string | null
}) {
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
  /** Where the pointer last was, in screen px — what the drop target is read from. */
  const dragPoint = useRef<{ x: number; y: number } | null>(null)
  /**
   * A pin dropped on top of a parcel, waiting on the "attach this family to
   * this property?" answer. The household is not written until it comes back,
   * and the pin keeps hanging at the drop point until then.
   */
  const [drop, setDrop] = useState<{
    hid: string
    familyName: string
    lng: number
    lat: number
    pid: string
    address: string | null
    householdCount: number
  } | null>(null)
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
   * Whether the map is being laid out for paper.
   *
   * A print is a screenshot of the WebGL canvas as it stands, so a landscape
   * page can only come from a landscape canvas — while this is on, the whole map
   * is a fixed 10.2-by-6.5in box in pixels and MapLibre has been told to redraw
   * at that shape. It lasts as long as the print dialog and no longer.
   */
  const [printing, setPrinting] = useState(false)
  /** The date the masthead prints. Set after mount — see the effect below. */
  const [printedOn, setPrintedOn] = useState('')
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
  /**
   * Organization highlighting.
   *
   * `groups` is every org and class the ward has anybody in, fetched once — see
   * /api/orgs/groups for why it ships whole. `groupKey` is the one currently
   * highlighted, or null. `groupOpen` is whether the member list under the
   * picker is unfolded; on a phone it is the difference between a card and a
   * card that covers the map.
   */
  const [groups, setGroups] = useState<MapGroup[]>([])
  const [groupKey, setGroupKey] = useState<string | null>(initialGroupKey)
  const [groupOpen, setGroupOpen] = useState(false)
  /**
   * Whether the org arriving in the URL has had its turn with the camera.
   *
   * The groups are fetched after mount, so a highlight from a link has no homes
   * to frame on the first render — and once framed it must not be framed again,
   * or every later edit to a parcel would yank the camera back.
   */
  const framedInitial = useRef(!initialGroupKey)

  /*
   * The date on the sheet, resolved after mount rather than while rendering.
   *
   * Not during render, because the server renders this too and its clock is in
   * another timezone — the two would disagree and hydration would throw it away.
   * Not in beforeprint either: a state update from there is flushed after the
   * browser has already snapshotted the page, so the first print of a session
   * would come out with no date on it.
   */
  useEffect(() => {
    setPrintedOn(
      new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    )
  }, [])

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
      // Groups are refreshed alongside the parcels rather than once on mount:
      // moving a family onto a house changes which parcel this org highlights,
      // and a stale index would leave the highlight on the old lot.
      const orgRes = await fetch('/api/orgs/groups', { cache: 'no-store' })
      if (orgRes.ok) setGroups(((await orgRes.json()) as { groups: MapGroup[] }).groups)
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
        // The drop question is a modal, so it takes Escape ahead of everything.
        if (drop) {
          setDrop(null)
          void load()
        } else if (picked.length) setPicked([])
        else if (selectMode) setSelectMode(false)
        else if (draft) setDraft(null)
        else if (placingPin) setPlacingPin(false)
        else if (selected) setSelected(null)
        // Last, not first: the highlight is a view the user chose to be in, so
        // it should survive backing out of everything drawn on top of it.
        else setGroupKey(null)
        return
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && draft) {
        e.preventDefault()
        setDraft((d) => (d && d.length > 1 ? d.slice(0, -1) : null))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placingPin, draft, selectMode, picked.length, drop, selected, load])

  const visibleKeys = useMemo(
    () => LEGEND.map((l) => l.key).filter((k) => !hiddenKeys.includes(k)),
    [hiddenKeys],
  )

  const activeGroup = useMemo(
    () => groups.find((g) => g.key === groupKey) ?? null,
    [groups, groupKey],
  )

  /**
   * The highlight's colour: whatever the org chart paints this organization with.
   *
   * A class takes its organization's colour rather than one of its own, exactly
   * as it does on the chart — a Primary class is Primary. Falls back to the
   * neutral tint so the layers below always hold a valid colour, including while
   * nothing is highlighted and their filters match nothing.
   */
  const tint = orgTint(activeGroup?.orgKey ?? 'other')
  const ink = orgInk(activeGroup?.orgKey ?? 'other')

  // Two lists, not one: an org and a class printed under it are different kinds
  // of answer, and a flat dropdown of sixty entries mixing them is unreadable.
  const orgOptions = useMemo(() => groups.filter((g) => g.kind === 'org'), [groups])
  const unitOptions = useMemo(() => groups.filter((g) => g.kind === 'unit'), [groups])

  /** Every parcel and pin the map has a shape for, so a member can be looked up. */
  const placed = useMemo(() => {
    const pids = new Set<string>()
    const hids = new Set<string>()
    for (const f of parcels.features) {
      if (f.properties.kind === 'parcel') pids.add(f.properties.pid)
      else hids.add(f.properties.hid)
    }
    return { pids, hids }
  }, [parcels])

  /**
   * The homes of the highlighted group.
   *
   * Keyed by household rather than by person: a couple who both serve in the
   * Primary is one house to knock on, and highlighting it twice says nothing
   * extra. `missing` counts the members whose household has neither a parcel nor
   * a pin — the honest number of people this highlight cannot show, which the
   * card prints rather than quietly dropping them.
   */
  const groupHomes = useMemo(() => {
    const empty = { homes: [] as GroupHome[], pids: [] as string[], hids: [] as string[], missing: 0 }
    if (!activeGroup) return empty
    // A record rather than a Map: `Map` is react-map-gl's component in this file.
    const byHousehold: Record<string, GroupHome> = {}
    for (const m of activeGroup.members) {
      let home = byHousehold[m.householdId]
      if (!home) {
        const target: PanelTarget | null =
          m.parcelId && placed.pids.has(m.parcelId)
            ? { kind: 'parcel', parcelId: m.parcelId }
            : placed.hids.has(m.householdId)
              ? { kind: 'pin', householdId: m.householdId }
              : null
        home = { householdId: m.householdId, familyName: m.familyName, target, people: [] }
        byHousehold[m.householdId] = home
      }
      home.people.push({
        personId: m.personId,
        name: m.name,
        callings: m.callings,
        via: m.via,
      })
    }
    const homes = Object.values(byHousehold).sort((a, b) =>
      a.familyName.localeCompare(b.familyName),
    )
    return {
      homes,
      pids: homes.flatMap((h) => (h.target?.kind === 'parcel' ? [h.target.parcelId] : [])),
      hids: homes.flatMap((h) => (h.target?.kind === 'pin' ? [h.target.householdId] : [])),
      missing: homes.filter((h) => !h.target).length,
    }
  }, [activeGroup, placed])

  const orgActive = groupHomes.pids.length > 0 || groupHomes.hids.length > 0
  /** Homes the highlight can actually draw — what the "N homes" count means. */
  const shownHomes = groupHomes.homes.length - groupHomes.missing

  // Written once and reused by every highlight layer and by the dimming on the
  // base ones, so "is this home in the group" can never mean two things.
  const isMemberParcel = useMemo(
    () => ['in', ['get', 'pid'], ['literal', groupHomes.pids]],
    [groupHomes.pids],
  )
  const isMemberPin = useMemo(
    () => ['in', ['get', 'hid'], ['literal', groupHomes.hids]],
    [groupHomes.hids],
  )

  const parcelFilter = useMemo(
    () =>
      [
        'all',
        ['==', ['get', 'kind'], 'parcel'],
        // A highlighted home is shown whatever the legend says. Otherwise asking
        // for the Primary and being given nine of its twelve homes — because
        // three are marked less-active and that key happens to be switched off —
        // is a wrong answer the map gives silently.
        orgActive
          ? ['any', ['in', parcelCategory, ['literal', visibleKeys]], isMemberParcel]
          : ['in', parcelCategory, ['literal', visibleKeys]],
      ] as never,
    [visibleKeys, orgActive, isMemberParcel],
  )

  // A pin is a household with no parcel, so it answers to its status key and to
  // nothing else — hiding "Business" must not take pinned homes with it.
  const pinFilter = useMemo(
    () =>
      [
        'all',
        ['==', ['get', 'kind'], 'pin'],
        orgActive
          ? [
              'any',
              ['in', ['coalesce', ['get', 'status'], 'unknown'], ['literal', visibleKeys]],
              isMemberPin,
            ]
          : ['in', ['coalesce', ['get', 'status'], 'unknown'], ['literal', visibleKeys]],
      ] as never,
    [visibleKeys, orgActive, isMemberPin],
  )

  // The highlight prints its own labels, from a lower zoom and in its own
  // colour, so the base ones step aside rather than write every name twice.
  const labelFilter = useMemo(
    () => (orgActive ? (['all', parcelFilter, ['!', isMemberParcel]] as never) : parcelFilter),
    [orgActive, parcelFilter, isMemberParcel],
  )
  const pinLabelFilter = useMemo(
    () => (orgActive ? (['all', pinFilter, ['!', isMemberPin]] as never) : pinFilter),
    [orgActive, pinFilter, isMemberPin],
  )

  const fillLayer: FillLayerSpecification = {
    id: 'parcel-fill',
    type: 'fill',
    source: 'parcels',
    filter: parcelFilter,
    paint: {
      'fill-color': fillColorByStatus as never,
      // Highlighting is subtractive: the group's homes keep their status colour
      // at full strength and everything else drops back to a hint of one. A
      // second colour on top would hide the very fact — active, less active,
      // vacant — that makes the highlight worth looking at.
      'fill-opacity': (orgActive
        ? ['case', isMemberParcel, 0.9, 0.12]
        : ['case', ['==', ['get', 'pid'], hovered ?? ''], 0.8, 0.55]) as never,
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
      'line-opacity': (orgActive ? ['case', isMemberParcel, 1, 0.25] : 1) as never,
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
    filter: labelFilter,
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
    filter: pinLabelFilter,
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

  /**
   * Organization highlight, in four layers.
   *
   * Nothing here repaints the homes: they keep their status colour (see the fill
   * layer above), so the highlight has to be carried entirely by what surrounds
   * them. A wide blurred line under a crisp thin one reads as a glow around the
   * lot, and unlike a thin outline it survives being drawn over aerial imagery.
   */
  const orgGlowLayer: LineLayerSpecification = {
    id: 'org-glow',
    type: 'line',
    source: 'parcels',
    filter: ['all', ['==', ['get', 'kind'], 'parcel'], isMemberParcel] as never,
    paint: {
      'line-color': tint,
      'line-width': 8,
      'line-blur': 4,
      'line-opacity': 0.4,
      'line-translate': translate,
    },
  }

  const orgLineLayer: LineLayerSpecification = {
    id: 'org-line',
    type: 'line',
    source: 'parcels',
    filter: ['all', ['==', ['get', 'kind'], 'parcel'], isMemberParcel] as never,
    paint: {
      'line-color': tint,
      'line-width': 2.4,
      'line-translate': translate,
    },
  }

  /** The same glow for a household that is a pin rather than a parcel. */
  const orgPinLayer: CircleLayerSpecification = {
    id: 'org-pin',
    type: 'circle',
    source: 'parcels',
    filter: ['all', ['==', ['get', 'kind'], 'pin'], isMemberPin] as never,
    paint: {
      'circle-radius': 15,
      'circle-color': tint,
      'circle-opacity': 0.3,
      'circle-stroke-width': 2,
      'circle-stroke-color': tint,
      'circle-translate': translate,
    },
  }

  /**
   * Names the highlighted homes, from two zoom levels further out than the base
   * labels and overlapping rather than dropping.
   *
   * Both are the point: a highlight you have to zoom in to read the names of
   * answers "where" but not "who", and a quorum presidency living three doors
   * apart is exactly the case where MapLibre would otherwise drop two of the
   * three labels it was asked to draw.
   */
  const orgLabelLayer: SymbolLayerSpecification = {
    id: 'org-label',
    type: 'symbol',
    source: 'parcels',
    minzoom: 14.5,
    filter: [
      'any',
      ['all', ['==', ['get', 'kind'], 'parcel'], isMemberParcel],
      ['all', ['==', ['get', 'kind'], 'pin'], isMemberPin],
    ] as never,
    layout: {
      'text-field': ['coalesce', ['get', 'familyName'], ''],
      'text-size': 12,
      'text-offset': [0, 1.05],
      'text-anchor': 'top',
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': ink,
      'text-halo-color': '#ffffff',
      'text-halo-width': 2,
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

  /**
   * Bounding box around a set of parcels and pins, or null when none of them are
   * on the map. Read off the loaded GeoJSON rather than asked of MapLibre, which
   * only knows about what is currently on screen.
   */
  const groupBounds = useCallback(
    (pids: string[], hids: string[]): [[number, number], [number, number]] | null => {
      const pidSet = new Set(pids)
      const hidSet = new Set(hids)
      let w = 180
      let s = 90
      let e = -180
      let n = -90
      let found = false
      const bump = (lng: number, lat: number) => {
        found = true
        w = Math.min(w, lng)
        e = Math.max(e, lng)
        s = Math.min(s, lat)
        n = Math.max(n, lat)
      }
      for (const f of parcels.features) {
        if (isParcelFeature(f)) {
          if (!pidSet.has(f.properties.pid)) continue
          for (const polygon of f.geometry.coordinates)
            for (const ring of polygon) for (const [lng, lat] of ring) bump(lng, lat)
        } else {
          if (!hidSet.has(f.properties.hid)) continue
          bump(f.geometry.coordinates[0], f.geometry.coordinates[1])
        }
      }
      return found ? [[w, s], [e, n]] : null
    },
    [parcels],
  )

  /** Frames every home in the highlighted group. */
  const fitGroup = useCallback(() => {
    const bounds = groupBounds(groupHomes.pids, groupHomes.hids)
    // maxZoom matters for a group of one: without it the camera flies to street
    // level, where the neighbouring houses that say *where* this is are off screen.
    if (bounds) mapRef.current?.fitBounds(bounds, { padding: 60, duration: 600, maxZoom: 17 })
  }, [groupBounds, groupHomes])

  /**
   * Frames an org that arrived in the URL, once — and only once its homes exist.
   * `fitGroup` is otherwise always somebody pressing a button.
   */
  useEffect(() => {
    if (framedInitial.current) return
    if (groupHomes.pids.length === 0 && groupHomes.hids.length === 0) return
    framedInitial.current = true
    fitGroup()
  }, [fitGroup, groupHomes])

  /**
   * A linked org nobody in the ward records actually belongs to yet is dropped
   * rather than left selected: the picker would read as a highlight that is on
   * while the map shows nothing highlighted.
   */
  useEffect(() => {
    if (groups.length === 0 || !groupKey) return
    if (!groups.some((g) => g.key === groupKey)) setGroupKey(null)
  }, [groups, groupKey])

  /** Opens one home from the member list, and takes the map to it. */
  const focusHome = useCallback(
    (home: GroupHome) => {
      if (!home.target) return
      const bounds =
        home.target.kind === 'parcel'
          ? groupBounds([home.target.parcelId], [])
          : groupBounds([], [home.target.householdId])
      if (bounds) mapRef.current?.fitBounds(bounds, { padding: 140, duration: 500, maxZoom: 18 })
      setSelected(home.target)
    },
    [groupBounds],
  )

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
      if (selectMode || draft || placingPin || drop) return false
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
      dragPoint.current = { x: point.x, y: point.y }
      const start = unnudge(lngLat)
      dragPinRef.current = { hid, lng: start.lng, lat: start.lat }
      setDragPin(dragPinRef.current)
      return true
    },
    [selectMode, draft, placingPin, drop, unnudge],
  )

  const movePinDrag = useCallback((
    lngLat: { lng: number; lat: number },
    point: { x: number; y: number },
  ): boolean => {
    const pin = dragPinRef.current
    if (!pin) return false
    dragMoved.current = true
    dragPoint.current = { x: point.x, y: point.y }
    const at = unnudge(lngLat)
    dragPinRef.current = { ...pin, lng: at.lng, lat: at.lat }
    setDragPin(dragPinRef.current)
    return true
  }, [unnudge])

  /** Writes a pin's new point. Used by a plain move and by "keep it a pin". */
  const savePinPoint = useCallback(
    async (hid: string, lng: number, lat: number) => {
      const res = await fetch(`/api/households/${encodeURIComponent(hid)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lng, lat }),
      })
      if (!res.ok) setError('Could not move that pin. Reload and try again.')
      // Reload either way: on failure this snaps the pin back to where it really is.
      await load()
    },
    [load],
  )

  const endPinDrag = useCallback(async (): Promise<boolean> => {
    const pin = dragPinRef.current
    if (!pin) return false
    dragPinRef.current = null
    mapRef.current?.getMap()?.dragPan.enable()
    setDragPin(null)
    if (!dragMoved.current) return true

    /*
     * Dropping onto a parcel is the whole point of this gesture: the import
     * leaves a pin for every household it could not match to a county parcel,
     * and dragging it onto the right house is how that gets fixed. The drop is
     * read off the screen point rather than the coordinate, so the query goes
     * through the same nudge the parcels are drawn with.
     */
    const at = dragPoint.current
    const hit = at
      ? mapRef.current?.getMap()?.queryRenderedFeatures([at.x, at.y], {
          layers: ['parcel-fill'],
        })?.[0]
      : undefined
    const pid = hit?.properties?.pid
    if (typeof pid === 'string') {
      const pinFeature = parcels.features.find(
        (f) => f.properties.kind === 'pin' && f.properties.hid === pin.hid,
      )
      setDrop({
        hid: pin.hid,
        familyName:
          pinFeature?.properties.kind === 'pin' ? pinFeature.properties.familyName : 'This family',
        lng: pin.lng,
        lat: pin.lat,
        pid,
        address: typeof hit?.properties?.address === 'string' ? hit.properties.address : null,
        householdCount:
          typeof hit?.properties?.householdCount === 'number' ? hit.properties.householdCount : 0,
      })
      return true
    }

    await savePinPoint(pin.hid, pin.lng, pin.lat)
    return true
  }, [parcels, savePinPoint])

  /** "Yes, this family lives here" — the household stops being a loose pin. */
  const attachDrop = useCallback(async () => {
    if (!drop) return
    setBusy(true)
    try {
      const res = await fetch(`/api/households/${encodeURIComponent(drop.hid)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parcel_id: drop.pid }),
      })
      // Cleared either way: on failure the reload puts the pin back where it
      // really is, and leaving the modal up over a stale ghost is worse than
      // the error banner.
      setDrop(null)
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'Could not attach that family to the property.')
        await load()
        return
      }
      await load()
      // Open the property, not the household: the pin is gone now, and this is
      // the confirmation that the family landed where it was meant to.
      setSelected({ kind: 'parcel', parcelId: drop.pid })
    } finally {
      setBusy(false)
    }
  }, [drop, load])

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
    // A pin awaiting the attach/keep answer stays where it was dropped, so the
    // modal is talking about a house the user can still see it sitting on.
    const ghost = dragPin ?? drop
    if (!ghost) return parcels
    return {
      ...parcels,
      features: parcels.features.map((f) =>
        f.properties.kind === 'pin' && f.properties.hid === ghost.hid
          ? { ...f, geometry: { type: 'Point' as const, coordinates: [ghost.lng, ghost.lat] } }
          : f,
      ),
    } as ParcelCollection
  }, [parcels, dragPin, drop])

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
      if (movePinDrag(e.lngLat, e.point)) return
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
    const parcelFeatures = parcels.features.filter(isParcelFeature)
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

  /**
   * Sizes the paper box to the canvas that is about to be printed.
   *
   * Runs on every print, the browser's own Cmd-P included — which is the reason
   * it measures rather than assuming the prepared shape. A canvas printed into a
   * box of a different aspect ratio comes out stretched, and a map stretched by
   * a third is a map with the wrong distances on it. The width gives way instead:
   * printed from a portrait window the map is narrower than the page, which is
   * honest, where a squashed ward is not.
   */
  useEffect(() => {
    const onBeforePrint = () => {
      const el = mapRef.current?.getMap().getContainer()
      if (!el) return
      const aspect = el.clientWidth / Math.max(1, el.clientHeight)
      const height = Math.min(MAP_MAX_H_IN, PAGE_W_IN / aspect)
      const style = document.documentElement.style
      style.setProperty('--ward-print-h', `${height.toFixed(2)}in`)
      style.setProperty('--ward-print-w', `${(height * aspect).toFixed(2)}in`)
    }
    window.addEventListener('beforeprint', onBeforePrint)
    return () => window.removeEventListener('beforeprint', onBeforePrint)
  }, [])

  /**
   * Prints the map as one landscape page.
   *
   * Three things have to happen before the dialog opens, in this order: the
   * container becomes the shape of the paper, MapLibre redraws at that shape,
   * and the tiles for the wider view finish arriving. Skip the last and the page
   * prints the grey checkerboard of a half-loaded map.
   *
   * The camera is re-fitted to the bounds it had rather than left on its centre
   * and zoom: in a box a third wider, the same zoom shows a taller strip of ward
   * than what was on screen, and what was on screen is what the user meant to
   * print. Widening only ever adds; nothing they were looking at falls off.
   */
  const doPrint = useCallback(async () => {
    const map = mapRef.current?.getMap()
    if (!map || printing) return
    const before = map.getBounds()
    const reflow = async (bounds: typeof before) => {
      // Two frames: one for React to commit the new size, one for the browser to
      // lay it out. resize() reads clientWidth, so it has to run after both.
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      map.resize()
      map.fitBounds(bounds, { padding: 0, duration: 0 })
    }
    setPrinting(true)
    try {
      await reflow(before)
      await drawn(map)
      // Blocks until the dialog is dismissed, which is what makes the restore
      // below safe to run straight after it.
      window.print()
    } finally {
      setPrinting(false)
      void reflow(before)
    }
  }, [printing])

  return (
    <div
      // Fixed rather than relative while printing so a box wider than the window
      // is simply clipped instead of adding scrollbars to the page underneath.
      // The print stylesheet takes this back into normal flow, where the
      // masthead, the map and the legend stack down one sheet.
      className={`ward-print-sheet w-full ${
        printing ? 'fixed left-0 top-0 z-50 overflow-hidden bg-white' : 'relative h-dvh'
      }`}
      style={
        printing
          ? { width: PRINT_PX_W, height: Math.round(PRINT_PX_W / PRINT_ASPECT) }
          : undefined
      }
    >
      {/*
        Print-only masthead.
        A map with no date on it is a map nobody can tell is out of date, and
        these are printed for a list of doors to knock — six months later the
        difference matters.
      */}
      <header className="hidden print:block">
        <div className="flex items-baseline justify-between gap-4 border-b border-neutral-300 pb-1">
          <h2 className="text-base font-semibold text-neutral-900">
            Ward Map
            {activeGroup && <span style={{ color: ink }}> &mdash; {groupTitle(activeGroup)}</span>}
          </h2>
          <p className="text-[10px] text-neutral-600">
            {counts.homes} homes &middot; {counts.withHouseholds} with a household
            {printedOn && ` \u00b7 ${printedOn}`}
          </p>
        </div>
      </header>

      <Map
        ref={mapRef}
        id="ward-map"
        mapStyle={MAP_STYLE_URL}
        // A WebGL canvas is blank the moment after it draws unless its buffer is
        // kept, and a print is read off that buffer. Without this the map prints
        // as an empty white rectangle.
        canvasContextAttributes={{ preserveDrawingBuffer: true }}
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
        onTouchMove={(e) => movePinDrag(e.lngLat, e.point)}
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
          {/* Glow under the fill so only its outer half shows, then the crisp
              line over the base outline it is meant to replace. */}
          <Layer {...orgGlowLayer} />
          <Layer {...outlineLayer} />
          <Layer {...orgLineLayer} />
          <Layer {...labelLayer} />
          {/* Under the pin itself: this is the halo around it, not a second dot. */}
          <Layer {...orgPinLayer} />
          <Layer {...pinLayer} />
          <Layer {...pinLabelLayer} />
          <Layer {...orgLabelLayer} />
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

      {/*
        Print-only legend.
        Only the keys that are switched on, because the print is of the map as
        filtered — a legend row for a colour that was hidden is a colour the
        reader will hunt the page for. The counts come along: 'Less active 34' is
        the number the council asks for next.
      */}
      <div className="hidden print:block">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-300 pt-1 text-[10px] text-neutral-700">
          {LEGEND.filter((l) => !hiddenKeys.includes(l.key)).map(({ key, label, color }) => (
            <li key={key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-sm ring-1 ring-inset ring-black/20"
                style={{ background: color }}
              />
              <span>{label}</span>
              <span className="tabular-nums text-neutral-500">{counts.byKey[key] ?? 0}</span>
            </li>
          ))}
          {activeGroup && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: tint }} />
              <span style={{ color: ink }}>
                {groupTitle(activeGroup)} &mdash; {shownHomes} home{shownHomes === 1 ? '' : 's'}
              </span>
            </li>
          )}
          {counts.pins > 0 && (
            <li className="flex items-center gap-1.5 text-neutral-500">
              <span aria-hidden>&#9679;</span>
              <span>Dot = home pinned without a parcel ({counts.pins})</span>
            </li>
          )}
        </ul>
      </div>

      {/* Legend + controls */}
      <div
        className="pointer-events-none absolute z-10 w-[min(20rem,calc(100vw-5.5rem))] print:hidden"
        style={{
          left: 'max(0.75rem, env(safe-area-inset-left))',
          top: 'max(0.75rem, env(safe-area-inset-top))',
        }}
      >
        <div className="pointer-events-auto rounded-lg bg-white/95 p-3 text-xs shadow-lg ring-1 ring-black/5 backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-sm font-semibold text-neutral-900">Ward Map</h1>
            <div className="flex items-center gap-1">
              {/*
                What comes out is the view on screen — the same zoom, the same
                filters, the same highlight — on one landscape page. On a phone
                too: the print canvas is a fixed size that has nothing to do with
                the window, and the browser's own print menu on a portrait screen
                is the one path that cannot fill the page.
              */}
              <button
                type="button"
                onClick={() => void doPrint()}
                disabled={printing}
                title="Print the map as it is on screen, on one landscape page"
                className="inline-flex items-center rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-800 hover:border-neutral-900 disabled:opacity-50"
              >
                {printing ? 'Preparing\u2026' : 'Print'}
              </button>
              {/* The map is one section of the app; the dashboard is the way to the rest. */}
              <Link
                href="/dashboard"
                className="inline-flex items-center rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-800 hover:border-neutral-900"
              >
                Dashboard
              </Link>
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

          {/*
            Organizations.
            Pick a quorum, a presidency or a Primary class and its homes light up
            while the rest of the ward falls back. Always visible, for the same
            reason the basemap switch is: it changes what you are looking at
            rather than how you edit it, and it is the answer to "who in this org
            lives near whom" that no list can give.
          */}
          <div className="mt-2">
            <label>
              <span className="sr-only">Highlight an organization</span>
              <select
                value={groupKey ?? ''}
                onChange={(e) => {
                  const value = e.target.value
                  setGroupKey(value || null)
                  // Folded shut on every change: the list belongs to the group
                  // that was open, and a new group's list is a different list.
                  setGroupOpen(false)
                }}
                disabled={groups.length === 0}
                className={`w-full rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-800 disabled:opacity-50 ${TAP}`}
              >
                <option value="">
                  {groups.length === 0
                    ? 'No organizations imported yet'
                    : 'Highlight an organization…'}
                </option>
                {orgOptions.length > 0 && (
                  <optgroup label="Organizations">
                    {orgOptions.map((g) => (
                      <option key={g.key} value={g.key}>
                        {groupTitle(g)} ({g.members.length})
                      </option>
                    ))}
                  </optgroup>
                )}
                {unitOptions.length > 0 && (
                  <optgroup label="Classes and groups">
                    {unitOptions.map((g) => (
                      <option key={g.key} value={g.key}>
                        {groupTitle(g)} ({g.members.length})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>

            {activeGroup && (
              <div
                className="mt-1.5 rounded-md border p-2"
                // The chart draws an organization as its tint at 6% inside a 30%
                // outline; this is the same recipe, so the card and the block on
                // the chart read as one colour rather than two that nearly match.
                // --org-wash is here because a row's hover cannot be an inline
                // style.
                style={
                  {
                    '--org-wash': `${tint}1f`,
                    background: `${tint}12`,
                    borderColor: `${tint}59`,
                  } as React.CSSProperties
                }
              >
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: tint }}
                  />
                  <div className="min-w-0 flex-1">
                    <Clamped className="font-medium" style={{ color: ink }}>
                      {groupTitle(activeGroup)}
                    </Clamped>
                    {/* People and homes are different numbers and both are
                        wanted: eleven people in seven houses is seven doors. The
                        leaders are called out because a Primary class highlight
                        is mostly children and two adults, and which of the
                        fourteen names are the adults is the first question. */}
                    <p className="text-[11px] text-neutral-600">
                      {activeGroup.members.length}{' '}
                      {activeGroup.members.length === 1 ? 'person' : 'people'}
                      {activeGroup.rosterCount > 0 && activeGroup.servesCount > 0 && (
                        <span className="text-neutral-500">
                          {' '}
                          ({activeGroup.servesCount} serving)
                        </span>
                      )}
                      {' · '}
                      {shownHomes} home{shownHomes === 1 ? '' : 's'}
                      {groupHomes.missing > 0 && (
                        <>
                          {' · '}
                          <span
                            className="text-amber-700"
                            title="These households have no parcel and no pin, so there is nothing to highlight"
                          >
                            {groupHomes.missing} not on the map
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <div className="mt-1.5 flex gap-1.5">
                  <button
                    type="button"
                    onClick={fitGroup}
                    disabled={shownHomes === 0}
                    style={{ borderColor: `${tint}80`, color: ink }}
                    className={`flex-1 rounded-md border bg-white px-2 text-[11px] font-medium disabled:opacity-40 ${TAP}`}
                  >
                    Zoom to fit
                  </button>
                  <button
                    type="button"
                    onClick={() => setGroupOpen((v) => !v)}
                    aria-expanded={groupOpen}
                    style={{ borderColor: `${tint}80`, color: ink }}
                    className={`flex-1 rounded-md border bg-white px-2 text-[11px] font-medium ${TAP}`}
                  >
                    {groupOpen ? 'Hide list' : `List ${groupHomes.homes.length}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setGroupKey(null)
                      setGroupOpen(false)
                    }}
                    style={{ borderColor: `${tint}80`, color: ink }}
                    className={`rounded-md border bg-white px-2 text-[11px] ${TAP}`}
                  >
                    Clear
                  </button>
                </div>

                {/* Capped and scrollable: Relief Society is most of the ward, and
                    a list that long would push the map off the screen. */}
                {groupOpen && (
                  <ul
                    style={{ borderColor: `${tint}40` }}
                    className="mt-1.5 max-h-52 space-y-0.5 overflow-y-auto border-t pt-1.5"
                  >
                    {groupHomes.homes.map((home) => (
                      <li key={home.householdId}>
                        <button
                          type="button"
                          onClick={() => focusHome(home)}
                          disabled={!home.target}
                          title={
                            home.target
                              ? 'Show this home on the map'
                              : 'This household has no parcel and no pin yet'
                          }
                          className={`w-full rounded px-1.5 py-1 text-left ${
                            home.target
                              ? 'hover:bg-[var(--org-wash)]'
                              : 'cursor-default opacity-50'
                          }`}
                        >
                          {/* Name over calling, one person per block. Callings
                              are long — 'Primary Activities - Boys 9 & 10
                              Specialist' — and on one line with the name neither
                              fits, so the name gets the line it needs to be
                              scanned down and the calling gets its own. */}
                          {home.people.map((person) => (
                            <span key={person.personId} className="mt-1 block first:mt-0">
                              <Clamped className="font-medium text-neutral-800">
                                {sortedName(person.name, home.familyName)}
                              </Clamped>
                              {/* 'Member' rather than a blank line: an empty
                                  second line under a name reads as missing data,
                                  and on a class roster it is the normal case. */}
                              {(person.callings.length > 0 || person.via === 'roster') && (
                                <Clamped className="text-[11px] text-neutral-500">
                                  {person.callings.length > 0
                                    ? person.callings.join(', ')
                                    : 'Member'}
                                </Clamped>
                              )}
                            </span>
                          ))}
                          {!home.target && (
                            <span className="block text-[11px] text-amber-700">Not on the map</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
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
          className="pointer-events-none absolute z-10 border-2 border-blue-600 bg-blue-500/20 print:hidden"
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
          className="absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center gap-2 border-t border-neutral-200 bg-white/95 px-3 py-2.5 text-xs shadow-lg backdrop-blur print:hidden sm:right-[26rem] sm:inset-x-auto sm:left-0"
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
          className="absolute inset-x-3 z-30 rounded-md bg-red-600 px-3 py-2 text-xs text-white shadow-lg print:hidden sm:inset-x-auto sm:left-3"
          style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          {error}
        </div>
      )}

      {drop && (
        <div
          className="absolute inset-0 z-40 flex items-end justify-center bg-black/40 p-4 print:hidden sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="drop-title"
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl">
            <h2 id="drop-title" className="text-sm font-semibold text-neutral-900">
              Move {drop.familyName} into this property?
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-neutral-600">
              {drop.address ?? 'This property'} — the household stops being a loose
              pin and is listed at this address.
              {drop.householdCount > 0 && (
                <>
                  {' '}
                  {drop.householdCount === 1
                    ? 'One household already lives here'
                    : `${drop.householdCount} households already live here`}
                  ; this one is added alongside them.
                </>
              )}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void attachDrop()}
                className={`rounded-md bg-blue-600 px-3 font-medium text-white disabled:opacity-50 ${TAP}`}
              >
                Yes, they live here
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const d = drop
                  setDrop(null)
                  await savePinPoint(d.hid, d.lng, d.lat)
                }}
                className={`rounded-md border border-neutral-300 px-3 text-neutral-800 disabled:opacity-50 ${TAP}`}
              >
                No, just move the pin here
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDrop(null)
                  // Nothing was written, so a reload puts the pin back where it was.
                  void load()
                }}
                className={`rounded-md px-3 text-neutral-500 disabled:opacity-50 ${TAP}`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The detail sheet is a thing you tap, and it covers a quarter of the
          map — neither belongs on paper. */}
      {selected && (
        <div className="print:hidden">
          <ParcelPanel
            target={selected}
            actorName={actorName}
            onClose={() => setSelected(null)}
            onChanged={load}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Resolves once the map has finished drawing everything it is going to draw.
 *
 * 'idle' is MapLibre's own word for it: the camera has stopped, every tile the
 * current view needs has arrived and the last frame is on the canvas. The
 * timeout is for the tile that never comes — a print of a partly loaded map
 * beats a Print button that does nothing on a bad connection.
 */
function drawn(map: MapLibreMap, timeoutMs = 6000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      map.off('idle', finish)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    map.once('idle', finish)
  })
}

/**
 * 'Jolene Van Ausdal' under the Van Ausdal household → 'Van Ausdal, Jolene'.
 *
 * Surname first because these lists are scanned down for a family, and that is
 * the order every church report prints. People are stored as a single
 * `full_name`, so the surname is recovered by matching the household's family
 * name off the end rather than by splitting on the last space — which would
 * print 'Ausdal, Jolene Van'.
 */
function sortedName(fullName: string, familyName: string): string {
  const name = fullName.trim()
  const family = familyName.trim()
  const suffix = ` ${family.toLowerCase()}`
  if (family && name.toLowerCase().endsWith(suffix)) {
    const given = name.slice(0, name.length - suffix.length).trim()
    if (given) return `${family}, ${given}`
  }
  // Somebody whose name does not end in their household's family name: a
  // grandmother under her daughter's roof, a hyphenated marriage, a typo. Left
  // exactly as recorded rather than guessed at.
  return name
}

/**
 * `properties.kind` is the discriminant, but it is nested: a check on it narrows
 * `f.properties` and leaves `f.geometry` a union, so anything that reads a
 * polygon's rings needs the predicate spelled out.
 */
function isParcelFeature(f: ParcelFeature | PinFeature): f is ParcelFeature {
  return f.properties.kind === 'parcel'
}

/**
 * 'Young Men › Deacons Quorum', 'Primary › Valiant 9'.
 *
 * The path is not decoration: half the sub-headings LCR prints are 'Presidency',
 * 'Teachers' or 'Ministering', which name nothing on their own.
 */
function groupTitle(g: MapGroup): string {
  return g.parentLabel ? `${g.parentLabel} \u203a ${g.label}` : g.label
}

/** The id the outline/circle paint expressions compare against, '' when nothing is selected. */
function selectedId(target: PanelTarget | null): string {
  if (!target) return ''
  return target.kind === 'parcel' ? target.parcelId : target.householdId
}
