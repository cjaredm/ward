'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NODE_H, NODE_W, layout, orgsIn, type Collapse } from '@/lib/org-layout'
import { orgLabel, orgTint as tint } from '@/lib/orgs'
import type { TreeNode } from '@/lib/org-tree'
import { SvgAvatar } from './Avatar'

/** The avatar on a calling box, and where its text starts because of it. */
const AVATAR = 30
const TEXT_X = 48

/** Rough character budget for the box width at each font size. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

export default function OrgChartGraph({ roots }: { roots: TreeNode[] }) {
  /**
   * The opening state: every organization folded down to its presidency, except
   * the bishopric, which is small enough to show whole. That is the view somebody
   * wants first — who leads what, all of it on one screen — and one tap on any
   * box opens the rest of that organization.
   */
  const [collapsed, setCollapsed] = useState<Collapse>(() => ({
    orgs: new Set(orgsIn(roots).filter((key) => key !== 'bishopric')),
    nodes: new Set<string>(),
  }))
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [selected, setSelected] = useState<string | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  /** Active pointers, so one finger pans and two pinch. */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; k: number } | null>(null)

  const { nodes, edges, clusters, width, height } = useMemo(
    () => layout(roots, collapsed),
    [roots, collapsed],
  )

  /** Scale and offset that fit the whole chart in the frame. */
  const fit = useCallback(() => {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return
    const k = Math.min(box.width / (width + 80), box.height / (height + 80), 1)
    setView({ x: 24, y: 24, k })
  }, [width, height])

  /**
   * The opening view: the chart at full size, top-left corner in the frame, which
   * is where the bishopric block always is. Scaled down only if the chart is
   * wider than the frame — a ward chart is far taller than a screen, and
   * shrinking it to fit that height makes every name too small to read.
   */
  const readable = useCallback(() => {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return
    const k = Math.min(1, box.width / (width + 48))
    setView({ x: 24, y: 24, k })
  }, [width])

  useEffect(() => {
    readable()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots])

  /** Open the organization a box belongs to, or fold it again from its leader. */
  function toggleOrg(key: string) {
    setCollapsed((prev) => {
      const orgs = new Set(prev.orgs)
      if (orgs.has(key)) orgs.delete(key)
      else orgs.add(key)
      return { orgs, nodes: prev.nodes }
    })
  }

  /** Open or close one box inside an organization that is already open. */
  function toggleNode(id: string) {
    setCollapsed((prev) => {
      const nodes = new Set(prev.nodes)
      if (nodes.has(id)) nodes.delete(id)
      else nodes.add(id)
      return { orgs: prev.orgs, nodes }
    })
  }

  function zoomAt(factor: number, cx: number, cy: number) {
    setView((v) => {
      const k = Math.min(2.5, Math.max(0.08, v.k * factor))
      // Keep the point under the cursor pinned while the scale changes.
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k }
    })
  }

  function onWheel(e: React.WheelEvent) {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return
    e.preventDefault()
    zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - box.left, e.clientY - box.top)
  }

  function onPointerDown(e: React.PointerEvent) {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }

  function onPointerMove(e: React.PointerEvent) {
    const previous = pointers.current.get(e.pointerId)
    if (!previous) return
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
      pinch.current = { distance, k: view.k }
      return
    }

    setView((v) => ({ ...v, x: v.x + (e.clientX - previous.x), y: v.y + (e.clientY - previous.y) }))
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  const expandAll = () => setCollapsed({ orgs: new Set(), nodes: new Set() })
  const collapseAll = () => setCollapsed({ orgs: new Set(orgsIn(roots)), nodes: new Set() })

  return (
    <div className="relative h-[calc(100dvh-13rem)] min-h-96 overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <div className="absolute top-3 right-3 z-10 flex flex-wrap justify-end gap-1.5 text-xs">
        {[
          { label: '−', title: 'Zoom out', run: () => zoomAt(0.8, 200, 200) },
          { label: '+', title: 'Zoom in', run: () => zoomAt(1.25, 200, 200) },
          { label: '100%', title: 'Full size, top of the chart', run: readable },
          { label: 'Fit', title: 'Shrink the whole chart into view', run: fit },
          { label: 'Expand all', title: 'Show every calling', run: expandAll },
          {
            label: 'Presidencies',
            title: 'Fold every organization down to its presidency',
            run: collapseAll,
          },
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            title={b.title}
            onClick={b.run}
            className="min-w-9 rounded-md border border-neutral-300 bg-white px-2 py-1.5 font-medium text-neutral-700 shadow-sm hover:border-neutral-900"
          >
            {b.label}
          </button>
        ))}
      </div>

      <div
        ref={frame}
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg className="h-full w-full select-none" role="img" aria-label="Ward org chart">
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {/* One shape per organization, behind everything, so a block reads as a
                single thing at any zoom. The bishopric is drawn heavier. */}
            {clusters.map((c) => {
              const lead = c.key === 'bishopric'
              return (
                <g key={c.key}>
                  <rect
                    x={c.x}
                    y={c.y}
                    width={c.w}
                    height={c.h}
                    rx={16}
                    fill={tint(c.key)}
                    fillOpacity={lead ? 0.1 : 0.06}
                    stroke={tint(c.key)}
                    strokeOpacity={lead ? 0.6 : 0.3}
                    strokeWidth={lead ? 2 : 1}
                  />
                  <text
                    x={c.x + 16}
                    y={c.y + 21}
                    fontSize={12}
                    fontWeight={700}
                    letterSpacing={0.6}
                    fill={tint(c.key)}
                  >
                    {orgLabel(c.key).toUpperCase()}
                  </text>
                </g>
              )
            })}

            {edges.map((e) => (
              <path
                key={e.id}
                d={e.path}
                fill="none"
                stroke={e.cross ? tint(e.to.cluster) : '#d4d4d4'}
                strokeOpacity={e.cross ? 0.5 : 1}
                strokeWidth={e.cross ? 1.75 : 1.5}
                strokeLinecap="round"
              />
            ))}

            {nodes.map((p) => {
              const isGroup = p.node.kind === 'group'
              const vacant = !isGroup && !p.node.person
              // Held, but by somebody the ward records do not know yet.
              const unlinked = !isGroup && Boolean(p.node.person) && !p.node.linked
              const active = selected === p.node.id
              // The leader of the block, printed a shade stronger than his people.
              const lead = p.indent === 0 && !isGroup
              return (
                <g
                  key={p.node.id}
                  transform={`translate(${p.x} ${p.y})`}
                  onClick={() => {
                    setSelected(p.node.id)
                    // Any box in a folded organization opens it; the leader of an
                    // open one folds it back up; anything else with people under
                    // it opens or closes just itself.
                    if (collapsed.orgs.has(p.cluster)) toggleOrg(p.cluster)
                    else if (p.head) toggleOrg(p.cluster)
                    else if (p.node.children.length > 0) toggleNode(p.node.id)
                  }}
                  className="cursor-pointer"
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={8}
                    fill={isGroup ? '#fafafa' : vacant ? '#fffbeb' : '#ffffff'}
                    stroke={
                      active
                        ? '#171717'
                        : vacant
                          ? '#fcd34d'
                          : unlinked
                            ? '#c7d2fe'
                            : lead
                              ? tint(p.cluster)
                              : '#e5e5e5'
                    }
                    strokeOpacity={lead && !active ? 0.7 : 1}
                    strokeWidth={active ? 2 : 1}
                    strokeDasharray={isGroup ? '4 3' : undefined}
                  />
                  {/* A face on every calling box, so a name is recognised before
                      it is read. Groups get none — they are sub-headings, not
                      people — which is why the text indent differs. */}
                  {!isGroup && (
                    <SvgAvatar
                      name={p.node.person}
                      photoUrl={p.node.photoUrl}
                      x={10}
                      y={(NODE_H - AVATAR) / 2}
                      size={AVATAR}
                      clipId={`avatar-${p.node.id}`}
                    />
                  )}
                  <text
                    x={isGroup ? 12 : TEXT_X}
                    y={23}
                    fontSize={13}
                    fontWeight={600}
                    fill={unlinked ? '#6366f1' : '#171717'}
                  >
                    {clip(isGroup ? p.node.title : (p.node.person ?? 'Vacant'), isGroup ? 26 : 21)}
                  </text>
                  <text
                    x={isGroup ? 12 : TEXT_X}
                    y={41}
                    fontSize={11}
                    fill={vacant ? '#b45309' : '#737373'}
                  >
                    {clip(
                      isGroup ? `${p.node.children.length} callings` : p.node.title,
                      isGroup ? 30 : 24,
                    )}
                  </text>
                  {p.collapsed && p.hidden > 0 && (
                    <>
                      <rect
                        x={NODE_W - 34}
                        y={NODE_H - 14}
                        width={34}
                        height={20}
                        rx={10}
                        fill="#171717"
                      />
                      <text
                        x={NODE_W - 17}
                        y={NODE_H}
                        fontSize={11}
                        fill="#ffffff"
                        textAnchor="middle"
                      >
                        +{p.hidden}
                      </text>
                    </>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
      </div>

      <p className="pointer-events-none absolute bottom-2 left-3 text-xs text-neutral-400">
        Drag to pan · scroll or pinch to zoom · tap a box to open or close what is under it
      </p>
    </div>
  )
}
