'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FLOORPLAN } from '@/lib/floorplan'
import {
  bbox,
  edgeMidpoint,
  labelAnchor,
  toPathD,
  type Pt,
} from '@/lib/floorplan-geom'
import { fitRoomLabel } from '@/lib/building-labels'
import { ROOM_STATUS, roomStatus } from '@/lib/building'
import { orgInk } from '@/lib/orgs'
import type { BuildingRoom, RoomAssignment } from '@/lib/types'

/** Where the drawing opens, in frame pixels, clear of the floating toolbar. */
const PAD = 16
const PAD_TOP = 56

/**
 * Handle sizes in **screen** pixels, divided by the scale when drawn.
 *
 * 22 is the invisible hit circle and it is the number that decides whether this
 * is usable with a thumb: 44px across, which is the minimum target this app uses
 * everywhere. The visible dot is deliberately much smaller than what you can hit.
 */
const HANDLE_R = 6
const HANDLE_HIT = 22
const MIDPOINT_R = 4
/** Below this scale the insert handles are more dots than the room has walls. */
const MIDPOINT_MIN_K = 0.55

export type Draft = {
  /** null while tracing a new room; a key while reshaping an existing one. */
  roomKey: string | null
  points: Pt[]
  /** The vertex being dragged or selected, so it can be removed. */
  active: number | null
  /** The ring as it was when the reshape opened, for Revert. */
  original: Pt[]
}

export type CanvasHandle = {
  /**
   * Fit the whole building in the frame.
   *
   * `padTop` is the gap left for the floating toolbar, which a print does not
   * have — passing PAD there is the difference between a plan centred on paper
   * and a plan with 40px of white above it.
   */
  fit: (padTop?: number) => void
  /** Zoom to one room, with a margin. */
  fitTo: (points: Pt[]) => void
  zoomBy: (factor: number) => void
  /**
   * The rectangle of the drawing the frame is currently showing, in floorplan
   * units. What "print what is on screen" is measured from — the frame is about
   * to change shape, and this is the part of the building that has to survive it.
   */
  viewport: () => { x: number; y: number; w: number; h: number } | null
  /** Show exactly this rectangle of the drawing, centred, nothing cropped. */
  showBox: (box: { x: number; y: number; w: number; h: number }, pad?: number) => void
  /** The pan and zoom as it stands, and the way back to it after a print. */
  snapshot: () => { x: number; y: number; k: number }
  restore: (view: { x: number; y: number; k: number }) => void
}

export default function BuildingCanvas({
  rooms,
  assignments,
  availability,
  slotId,
  selectedKey,
  draft,
  dimAssigned = false,
  hideClosed = false,
  printRegion,
  printWidthPx = 998,
  onSelect,
  onDraftChange,
  onReady,
}: {
  rooms: BuildingRoom[]
  /** The assignments for the hour being shown, by room key. */
  assignments: Map<string, RoomAssignment[]>
  /** The per-hour availability overrides, from `indexAvailability`. */
  availability: Map<string, boolean>
  /** The hour being shown; null before one is picked. */
  slotId: string | null
  selectedKey: string | null
  draft: Draft | null
  /**
   * Fade the rooms that already have a class this hour, so the free ones are
   * what stands out. "Which rooms are free" is the question a schedule actually
   * gets checked for, and it is hard to read off a map where every room is lit.
   */
  dimAssigned?: boolean
  /**
   * Leave the rooms nothing can meet in off the drawing entirely — the hallways
   * and whatever is closed this hour. Not dimmed: somebody scheduling classes is
   * looking at a plan where half the outlines can never be an answer, and taking
   * them away is what makes the rest legible.
   */
  hideClosed?: boolean
  /**
   * The rectangle of the drawing the printed page is of.
   *
   * Required, and used on every render rather than only while printing: the
   * print SVG is always in the DOM so that the browser's own Cmd-P prints the
   * same page the Print button does. Normally the building's own extent; the
   * part of it on screen when somebody asked for this view.
   */
  printRegion: { x: number; y: number; w: number; h: number }
  /**
   * The width in pixels the region is expected to print at, which is what the
   * label ladder is measured against. Only the ratio to `printRegion.w` matters:
   * on wider paper the whole drawing, labels included, scales up together.
   */
  printWidthPx?: number
  onSelect: (key: string | null) => void
  onDraftChange: (next: Draft) => void
  onReady: (handle: CanvasHandle) => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ x: PAD, y: PAD_TOP, k: 0.4 })
  /** Active pointers, so one finger pans and two pinch. */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number } | null>(null)
  /**
   * Set the moment a drag actually moves. A pointer-up that never moved is a
   * click — a tap on a room selects it, a tap on the canvas adds a corner — and
   * without this every pan would end in one of those too.
   */
  const moved = useRef(false)
  /** The vertex being dragged, held in a ref so pointermove does not re-close. */
  const dragging = useRef<number | null>(null)

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => {
      const k = Math.min(6, Math.max(0.08, v.k * factor))
      // Keep the point under the cursor pinned while the scale changes.
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k }
    })
  }, [])

  const fit = useCallback((padTop: number = PAD_TOP) => {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return
    const k = Math.min(
      (box.width - PAD * 2) / FLOORPLAN.width,
      (box.height - padTop - PAD) / FLOORPLAN.height,
    )
    setView({
      x: (box.width - FLOORPLAN.width * k) / 2,
      y: padTop + (box.height - padTop - PAD - FLOORPLAN.height * k) / 2,
      k,
    })
  }, [])

  /**
   * The view, mirrored, so `viewport` below can be a stable callback.
   *
   * The handle is handed up through `onReady` — rebuilding it on every pan would
   * re-run that effect on every pointermove for the sake of one method nothing
   * calls while panning.
   */
  const viewRef = useRef(view)
  viewRef.current = view

  const viewport = useCallback(() => {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return null
    const v = viewRef.current
    return { x: -v.x / v.k, y: -v.y / v.k, w: box.width / v.k, h: box.height / v.k }
  }, [])

  /**
   * Fits an arbitrary rectangle rather than a room's ring, and with no margin of
   * its own by default: a print asks for a box that already carries the padding
   * it wants, and half a room's width added to it would crop the far wall.
   */
  const showBox = useCallback(
    (box: { x: number; y: number; w: number; h: number }, pad = 0) => {
      const frameBox = frame.current?.getBoundingClientRect()
      if (!frameBox || box.w <= 0 || box.h <= 0) return
      const k = Math.min(
        (frameBox.width - pad * 2) / box.w,
        (frameBox.height - pad * 2) / box.h,
      )
      setView({
        x: frameBox.width / 2 - (box.x + box.w / 2) * k,
        y: frameBox.height / 2 - (box.y + box.h / 2) * k,
        k,
      })
    },
    [],
  )

  const snapshot = useCallback(() => viewRef.current, [])
  const restore = useCallback((v: { x: number; y: number; k: number }) => setView(v), [])

  const fitTo = useCallback((points: Pt[]) => {
    const box = frame.current?.getBoundingClientRect()
    if (!box || points.length === 0) return
    const b = bbox(points)
    // A margin of half the room again, so the walls around it are visible too —
    // a room zoomed to its own edges gives no sense of where it is.
    const margin = 0.5
    const k = Math.min(
      6,
      Math.min(
        (box.width - PAD * 2) / (b.w * (1 + margin)),
        (box.height - PAD_TOP - PAD) / (b.h * (1 + margin)),
      ),
    )
    setView({
      x: box.width / 2 - (b.x + b.w / 2) * k,
      y: (PAD_TOP + box.height) / 2 - (b.y + b.h / 2) * k,
      k,
    })
  }, [])

  // Opens fitted to the whole building. Unlike the org chart, which opens at full
  // size because a ward chart is taller than any screen, here the whole floorplan
  // on one screen *is* the useful view — the question is "which room".
  useEffect(() => {
    fit()
  }, [fit])

  useEffect(() => {
    onReady({
      fit,
      fitTo,
      viewport,
      showBox,
      snapshot,
      restore,
      zoomBy: (factor) => {
        const box = frame.current?.getBoundingClientRect()
        zoomAt(factor, (box?.width ?? 400) / 2, (box?.height ?? 400) / 2)
      },
    })
  }, [fit, fitTo, viewport, showBox, snapshot, restore, zoomAt, onReady])

  /** A pointer position in floorplan units. */
  const toUser = useCallback(
    (e: { clientX: number; clientY: number }): Pt => {
      const box = frame.current?.getBoundingClientRect()
      if (!box) return [0, 0]
      return [
        Math.round(((e.clientX - box.left - view.x) / view.k) * 10) / 10,
        Math.round(((e.clientY - box.top - view.y) / view.k) * 10) / 10,
      ]
    },
    [view],
  )

  function onWheel(e: React.WheelEvent) {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return
    e.preventDefault()
    zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - box.left, e.clientY - box.top)
  }

  function onPointerDown(e: React.PointerEvent) {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    moved.current = false
  }

  function onPointerMove(e: React.PointerEvent) {
    const previous = pointers.current.get(e.pointerId)
    if (!previous) return
    const dx = e.clientX - previous.x
    const dy = e.clientY - previous.y
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved.current = true
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    const points = [...pointers.current.values()]
    if (points.length >= 2) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
      const box = frame.current?.getBoundingClientRect()
      if (pinch.current && box) {
        const midX = (points[0].x + points[1].x) / 2 - box.left
        const midY = (points[0].y + points[1].y) / 2 - box.top
        zoomAt(distance / pinch.current.distance, midX, midY)
      }
      pinch.current = { distance }
      return
    }

    // Dragging a vertex moves the vertex; anything else moves the drawing.
    if (dragging.current !== null && draft) {
      const at = toUser(e)
      const next = [...draft.points]
      next[dragging.current] = at
      onDraftChange({ ...draft, points: next, active: dragging.current })
      return
    }

    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) dragging.current = null
  }

  /** A click on empty canvas: adds a corner while tracing, else clears selection. */
  function onCanvasClick(e: React.MouseEvent) {
    if (moved.current) return
    if (draft) {
      // Only while tracing a new room. Appending to a reshape would grow the ring
      // every time somebody tapped to look at it.
      if (draft.roomKey === null) {
        onDraftChange({ ...draft, points: [...draft.points, toUser(e)], active: null })
      }
      return
    }
    onSelect(null)
  }

  /** Room paths are memoized: `d` strings must not be rebuilt on every pan frame. */
  const shapes = useMemo(
    () =>
      rooms
        .map((room) => {
          const here = assignments.get(room.key) ?? []
          const first = here[0] ?? null
          const box = bbox(room.points)
          const status = roomStatus(room, slotId, availability, here.length)
          return {
            room,
            d: toPathD(room.points),
            box,
            anchor: room.label ?? labelAnchor(room.points),
            here,
            first,
            status,
            paint: ROOM_STATUS[status],
            // The fill says whether the room is free; the organization's colour
            // is what the label is written in, so a green room still reads as
            // Primary or Relief Society at a glance and the legend still means
            // something.
            ink: first?.org_key ? orgInk(first.org_key) : null,
          }
        })
        .filter((shape) => !hideClosed || shape.status !== 'closed'),
    [rooms, assignments, availability, slotId, hideClosed],
  )

  /**
   * The drawing: the walls, then every room over them.
   *
   * A function of the scale rather than markup in one place, because it is
   * rendered twice — once into the interactive canvas at the zoom the window is
   * showing, and once into the print SVG at the scale the paper will show it.
   * Everything sized in constant screen pixels divides by `k`, and the label
   * ladder is measured against it, so the two copies differ in exactly that one
   * number and cannot otherwise drift apart.
   */
  const drawing = (k: number) => (
    <>
          {/* The walls, as a static asset. pointer-events none so they can never
              swallow a tap meant for a room. */}
          <image
            href={FLOORPLAN.src}
            x={0}
            y={0}
            width={FLOORPLAN.width}
            height={FLOORPLAN.height}
            style={{ pointerEvents: 'none' }}
          />

          {shapes.map(({ room, d, box, anchor, here, first, status, paint, ink }) => {
            const selected = room.key === selectedKey
            const dim = dimAssigned && status === 'booked'
            const closed = status === 'closed'
            // A scheduled class and the room somebody has open are the two
            // things that must never go unlabelled; everything else may render
            // nothing rather than clutter a zoomed-out plan with callouts.
            const label = fitRoomLabel(
              first?.title ?? null,
              room.name,
              { w: box.w * k, h: box.h * k },
              selected || here.length > 0,
            )
            return (
              <g key={room.key} opacity={dim ? 0.25 : 1}>
                <path
                  d={d}
                  fill={paint.fill}
                  fillOpacity={paint.fillOpacity}
                  stroke={selected ? '#a9691a' : (ink ?? paint.stroke)}
                  strokeWidth={(selected ? 2.4 : 1) / k}
                  className={closed ? 'cursor-default' : 'cursor-pointer'}
                  onClick={(e) => {
                    if (moved.current || draft) return
                    e.stopPropagation()
                    onSelect(selected ? null : room.key)
                  }}
                >
                  {/* Covers every room the label ladder dropped, and gives the
                      screen reader the same sentence. */}
                  <title>
                    {here.length > 0
                      ? `${room.name} — ${here.map((a) => a.title).join(', ')}`
                      : `${room.name} — ${
                          status === 'free'
                            ? 'free this hour'
                            : room.is_assignable
                              ? 'not available this hour'
                              : 'not a class space'
                        }`}
                  </title>
                </path>

                {selected && (
                  <path
                    d={d}
                    fill="#e0902c"
                    fillOpacity={0.28}
                    style={{ pointerEvents: 'none' }}
                  />
                )}

                {label && label.mode === 'inside' && (
                  <text
                    x={anchor[0]}
                    y={anchor[1]}
                    textAnchor="middle"
                    // Constant screen size. Scaling the font to the room makes the
                    // cultural hall 80px and room 101 three pixels.
                    fontSize={label.px / k}
                    fill={ink ?? (closed ? '#737373' : '#3f3f46')}
                    fontWeight={first ? 600 : 500}
                    // A label is allowed to overhang its walls, so it is painted
                    // with a white outline underneath: it stays readable where it
                    // crosses a wall line or the room next door.
                    stroke="#fff"
                    strokeWidth={2.5 / k}
                    paintOrder="stroke"
                    style={{ pointerEvents: 'none' }}
                  >
                    {label.lines.map((line, i) => (
                      <tspan
                        key={i}
                        x={anchor[0]}
                        dy={
                          i === 0
                            ? -((label.lines.length - 1) * label.px * 0.6) / k
                            : (label.px * 1.2) / k
                        }
                      >
                        {line}
                      </tspan>
                    ))}
                    {here.length > 1 && (
                      <tspan x={anchor[0]} dy={(label.px * 1.2) / k} fontWeight={400}>
                        {`+${here.length - 1} more`}
                      </tspan>
                    )}
                  </text>
                )}

                {label && label.mode === 'callout' && (
                  <Callout
                    anchor={anchor}
                    box={box}
                    text={label.lines[0]}
                    extra={here.length > 1 ? `+${here.length - 1} more` : null}
                    px={label.px}
                    k={k}
                    ink={ink ?? (closed ? '#737373' : '#3f3f46')}
                    bold={Boolean(first)}
                  />
                )}
              </g>
            )
          })}
    </>
  )

  return (
    <div
      ref={frame}
      className={`h-full w-full overflow-hidden ${
        draft ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
      } touch-none`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onCanvasClick}
    >
      {/*
        The screen's drawing. No viewBox on purpose: with one there are two
        transforms in play — the viewBox fitting 2252x1183 into an
        arbitrary-aspect frame, and this pan and zoom — and inverting only the
        second silently offsets every traced corner. All the scaling lives in the
        <g>, exactly as the org chart does it.
      */}
      <svg
        className="h-full w-full select-none print:hidden"
        role="img"
        aria-label="Stake centre floorplan"
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {drawing(view.k)}

          {draft && (
            <DraftOverlay
              draft={draft}
              k={view.k}
              onDraftChange={onDraftChange}
              dragging={dragging}
            />
          )}
        </g>
      </svg>

      {/*
        The paper's drawing, and the reason a print is not a screenshot of the
        one above.

        Always in the DOM and always hidden on screen, so it is the same picture
        whether the print came from the Print button or from the browser's own
        Cmd-P. It was conditional before, which meant Cmd-P fell back to printing
        the screen's canvas — laid out for the window, letterboxed inside it, and
        scaled down to fit the paper with the window's empty margins still in it.
        That is the white space down both sides of the page.

        A viewBox is safe here for the reason it is not safe above: nothing on a
        printed page is ever clicked, so there is no inverse transform to get
        wrong. It also does the one thing the <g> transform cannot — size itself
        to the paper rather than to a pixel count — which is why the plan now
        reaches both edges of letter, A4 and tabloid alike.
      */}
      <svg
        className="hidden h-full w-full select-none print:block"
        aria-hidden
        viewBox={`${printRegion.x} ${printRegion.y} ${printRegion.w} ${printRegion.h}`}
      >
        {drawing(printWidthPx / printRegion.w)}
      </svg>
    </div>
  )
}

/**
 * A label for a room too small to hold one, parked clear of the room with a line
 * back to it.
 *
 * Which side it goes on is decided by where the room sits on the plan, not by
 * what else is nearby: a real collision solver would have to re-run on every
 * zoom step for every room, and the rooms that need a callout at all are the
 * small ones round the edges, where "away from the middle of the building" is
 * almost always into empty paper.
 *
 * Deliberately no collision avoidance beyond that. Two callouts overlapping is a
 * cue to zoom in, which is the gesture that makes both labels fit inside their
 * own rooms anyway.
 */
function Callout({
  anchor,
  box,
  text,
  extra,
  px,
  k,
  ink,
  bold,
}: {
  anchor: Pt
  box: { x: number; y: number; w: number; h: number }
  text: string
  extra: string | null
  px: number
  k: number
  ink: string
  bold: boolean
}) {
  // Screen pixels, converted at the end, so the leader is the same length at
  // every zoom rather than growing with the building.
  const reach = 26 / k
  const right = anchor[0] < FLOORPLAN.width / 2
  const edgeX = right ? box.x + box.w : box.x
  const tipX = edgeX + (right ? reach : -reach)

  return (
    <g style={{ pointerEvents: 'none' }}>
      <line
        x1={edgeX}
        y1={anchor[1]}
        x2={tipX}
        y2={anchor[1]}
        stroke={ink}
        strokeWidth={1 / k}
        strokeOpacity={0.65}
      />
      <circle cx={edgeX} cy={anchor[1]} r={1.6 / k} fill={ink} />
      <text
        x={tipX + (right ? 3 / k : -3 / k)}
        y={anchor[1]}
        textAnchor={right ? 'start' : 'end'}
        dominantBaseline="middle"
        fontSize={px / k}
        fill={ink}
        fontWeight={bold ? 600 : 500}
        // Painted over walls and whatever else is out here, so it needs its own
        // ground rather than relying on empty paper being empty.
        stroke="#fff"
        strokeWidth={3 / k}
        paintOrder="stroke"
      >
        <tspan x={tipX + (right ? 3 / k : -3 / k)} dy={extra ? -(px * 0.55) / k : 0}>
          {text}
        </tspan>
        {extra && (
          <tspan x={tipX + (right ? 3 / k : -3 / k)} dy={(px * 1.15) / k} fontWeight={400}>
            {extra}
          </tspan>
        )}
      </text>
    </g>
  )
}

/**
 * The outline being traced or reshaped, and its handles.
 *
 * Split out so the vertex handles are not rebuilt as part of every room in the
 * building on each drag frame.
 */
function DraftOverlay({
  draft,
  k,
  onDraftChange,
  dragging,
}: {
  draft: Draft
  k: number
  onDraftChange: (next: Draft) => void
  dragging: React.RefObject<number | null>
}) {
  const { points } = draft
  const closed = points.length >= 3

  return (
    <g>
      {points.length >= 2 && (
        <path
          d={closed ? toPathD(points) : `M${points.map((p) => `${p[0]},${p[1]}`).join(' L')}`}
          fill={closed ? '#e0902c' : 'none'}
          fillOpacity={0.3}
          stroke="#a9691a"
          strokeWidth={1.6 / k}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Insert-a-corner handles, hidden when zoomed out: on the cultural hall's
          22-corner outline they would otherwise be a field of dots. */}
      {closed &&
        k >= MIDPOINT_MIN_K &&
        points.map((_, i) => {
          const [mx, my] = edgeMidpoint(points, i)
          return (
            <g key={`mid-${i}`}>
              <circle cx={mx} cy={my} r={MIDPOINT_R / k} fill="#fff" stroke="#a9691a" strokeWidth={1.2 / k} />
              <circle
                cx={mx}
                cy={my}
                r={HANDLE_HIT / k}
                fill="transparent"
                className="cursor-copy"
                onClick={(e) => {
                  e.stopPropagation()
                  const next = [...points]
                  next.splice(i + 1, 0, [mx, my])
                  onDraftChange({ ...draft, points: next, active: i + 1 })
                }}
              >
                <title>Add a corner here</title>
              </circle>
            </g>
          )
        })}

      {points.map((p, i) => (
        <g key={`pt-${i}`}>
          <circle
            cx={p[0]}
            cy={p[1]}
            r={HANDLE_R / k}
            fill={draft.active === i ? '#a9691a' : '#fff'}
            stroke="#a9691a"
            strokeWidth={1.6 / k}
          />
          {/* The transparent hit circle is the 44px target; the dot above is only
              what it looks like. */}
          <circle
            cx={p[0]}
            cy={p[1]}
            r={HANDLE_HIT / k}
            fill="transparent"
            className="cursor-move"
            // Deliberately NOT stopping propagation on pointer events: the drag
            // itself is handled on the frame, which needs to see the down (to
            // register the pointer) and every move. Claiming `dragging` here is
            // what stops the frame panning instead — it takes the vertex branch.
            //
            // The click IS stopped, because a tap that never moved would
            // otherwise reach the canvas and append a corner on top of this one.
            onPointerDown={() => {
              dragging.current = i
              onDraftChange({ ...draft, active: i })
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <title>{`Corner ${i + 1} — drag to move`}</title>
          </circle>
        </g>
      ))}
    </g>
  )
}
