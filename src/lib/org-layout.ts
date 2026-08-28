/**
 * Geometry for the org chart: where every box goes, which boxes are hidden, and
 * how the lines get from one organization to the next.
 *
 * The chart is laid out by organization rather than by depth. A tidy tree puts
 * every box of the same depth in the same column, which tears an organization
 * apart — the Elders Quorum secretary ends up level with a Primary teacher, half
 * a screen away from his own president. Nobody reads a ward chart that way. They
 * look for an organization first and a person second.
 *
 * So each organization is laid out as one tight block — an indented outline, the
 * leader on top and everyone under him stepped in beneath — and the blocks are
 * then arranged by who reports to whom: a band of blocks per level of authority,
 * each block pulled towards the column its parent organization is in. The
 * bishopric is block zero, top-left, so it is the first thing on screen without
 * any scrolling.
 *
 * The blocks sit on a grid with a gap on every side, which leaves empty corridors
 * between them, and every line from one organization to another is routed along
 * those corridors. That is what keeps a line off the top of somebody else's
 * organization: it goes around, never through.
 *
 * Kept out of the component so it can be checked without a browser — an overlap,
 * or a line crossing a block it has no business in, is a layout bug and a test
 * catches it faster than looking at 300 boxes does.
 */
import { countDescendants, type TreeNode } from './org-tree'

/** Node box. Points, in chart space. */
export const NODE_W = 220
export const NODE_H = 52

/** Inside a block: rows, how far each level steps in, and when to start a new column. */
const ROW_GAP = 8
const INDENT = 20
const MAX_INDENT_LEVEL = 3
const MAX_COL_ROWS = 12
const COL_GAP = 18

/** Block padding. The top is deep enough for the organization's name. */
const PAD_X = 14
const PAD_TOP = 32
const PAD_BOTTOM = 14

/**
 * Between blocks. Also the width of every corridor the lines run down, so it has
 * to be wide enough for a bundle of them.
 */
const CLUSTER_GAP = 44

/** How far a band of blocks may run before it wraps onto the next one. */
const MAX_BAND_W = 2600

/**
 * Packed mode: every organization on the page, no lines, no bands.
 *
 * The connected chart spends most of its space on the reporting lines — the
 * corridors between blocks, and the empty band under every level so a line has
 * somewhere to run. That is the right trade when the question is "who answers to
 * whom", and the wrong one when the question is "where is the Primary" — then it
 * is a mostly-empty page you have to drag across. Packed mode drops the lines
 * and closes the gaps: blocks fall into the shortest column, a hair apart.
 */
const PACKED_GAP = 16

/**
 * The shape packed mode aims for, width over height. Roughly a landscape screen,
 * so 'Fit' lands on something readable instead of a strip three blocks wide or a
 * single tall column.
 */
const PACKED_ASPECT = 1.6

/**
 * How far from its parent a block may be placed, in columns, given how many child
 * organizations that parent has.
 *
 * Blocks fill a band by dropping into whichever column is emptiest, because
 * organizations differ wildly in height — Primary is ten times the Young Single
 * Adult leader — and packing them tightly is what stops a screen of white opening
 * under every short one. Left at that, though, a Nursery lands in whatever column
 * happened to be empty and ends up the width of the chart from the Primary it is
 * part of, which is worse than the white space.
 *
 * So the emptiest column is only ever chosen from a window around the parent's
 * own. A parent with one child organization gets a window of one column — the
 * Nursery goes under Primary or nowhere — while the bishopric, with a dozen, gets
 * a window wide enough to spread them across the band.
 */
const reachFor = (children: number) => Math.floor(children / 2)

/** Corner radius on a routed line. */
const BEND = 10

/**
 * What is folded away.
 *
 * `orgs` holds organizations shown as their presidency only — the default, and
 * what somebody opening the page wants: every presidency in the ward at once.
 * `nodes` holds single boxes closed inside an open organization, which is what a
 * sub-heading like 'Teachers' is for.
 */
export type Collapse = { orgs: Set<string>; nodes: Set<string> }

export type Placed = {
  node: TreeNode
  x: number
  y: number
  /** Depth in the tree, unchanged by how the blocks are arranged. */
  depth: number
  /** How far in this box is stepped inside its own block, in levels. */
  indent: number
  /** Which organization block it belongs to. */
  cluster: string
  /** True on the top box of its block — the leader, and the box that folds it. */
  head: boolean
  collapsed: boolean
  /** How many callings are hidden behind this box. */
  hidden: number
}

/** The translucent shape drawn behind one organization. */
export type ClusterBox = {
  key: string
  x: number
  y: number
  w: number
  h: number
  /** Levels of authority between this organization and the bishopric. */
  depth: number
  /** Visible boxes inside it. */
  count: number
  /** True while the organization is folded down to its presidency. */
  folded: boolean
}

export type Edge = {
  id: string
  from: Placed
  to: Placed
  /** True when the line leaves one organization for another. */
  cross: boolean
  /** Ready to draw, routed clear of every block. */
  path: string
}

export type Layout = {
  nodes: Placed[]
  edges: Edge[]
  clusters: ClusterBox[]
  width: number
  height: number
}

/**
 * Titles that belong to a presidency: the counsellors, the secretary, the clerks.
 * Matched on the leader's own children only, so an assistant secretary — who
 * hangs off the secretary, a level further down — is not one of them.
 */
const PRESIDENCY_ROLE = /(?:Counselor|Secretary|Clerk)$/

/** Every organization with a box in the chart, bishopric first. */
export function orgsIn(roots: TreeNode[]): string[] {
  const seen: string[] = []
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (!seen.includes(n.org)) seen.push(n.org)
      walk(n.children)
    }
  }
  walk(roots)
  return seen
}

/**
 * The boxes an organization shows when it is folded: its leader and his
 * presidency. Everything else in it waits behind a '+N' badge.
 */
export function presidencies(roots: TreeNode[]): Map<string, Set<string>> {
  /** Shallowest depth each organization reaches — where its leader sits. */
  const top = new Map<string, number>()
  const measure = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      const best = top.get(n.org)
      if (best === undefined || depth < best) top.set(n.org, depth)
      measure(n.children, depth + 1)
    }
  }
  measure(roots, 0)

  const keep = new Map<string, Set<string>>()
  const add = (org: string, id: string) => {
    const set = keep.get(org)
    if (set) set.add(id)
    else keep.set(org, new Set([id]))
  }

  const collect = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      if (depth === top.get(n.org)) {
        add(n.org, n.id)
        for (const kid of n.children) {
          if (kid.org === n.org && kid.kind === 'calling' && PRESIDENCY_ROLE.test(kid.title)) {
            add(n.org, kid.id)
          }
        }
      }
      collect(n.children, depth + 1)
    }
  }
  collect(roots, 0)
  return keep
}

type Visit = {
  node: TreeNode
  /** Nearest box above this one that is actually on the page. */
  parent: TreeNode | null
  depth: number
  collapsed: boolean
  head: boolean
  hidden: number
}

/** A block on the grid, and the corridors around it. */
type Block = {
  key: string
  placed: Placed[]
  w: number
  h: number
  depth: number
  /** Which column of the grid it is in. */
  col: number
  /** Corridor on its near side, its far side, and below its band. */
  laneIn: number
  laneOut: number
  laneBelow: number
}

export function layout(
  roots: TreeNode[],
  collapse: Collapse,
  /** False to drop the reporting lines and pack the blocks together. */
  connected = true,
): Layout {
  const pres = presidencies(roots)

  // Everything visible, in report order, parents before children. A box hidden
  // by a folded organization is stepped over rather than stopped at: its own
  // people fold away with it, but a child organization hanging off it still
  // belongs on the page, reporting to the nearest box that is left.
  const visits: Visit[] = []
  const foldedAway = new Map<string, number>()
  const heads = new Set<string>()

  function walk(node: TreeNode, parent: TreeNode | null, depth: number) {
    const folded = collapse.orgs.has(node.org)
    const shown = !folded || Boolean(pres.get(node.org)?.has(node.id))

    if (!shown) {
      foldedAway.set(node.org, (foldedAway.get(node.org) ?? 0) + 1)
      for (const kid of node.children) walk(kid, parent, depth + 1)
      return
    }

    const head = !heads.has(node.org)
    if (head) heads.add(node.org)
    const closed = collapse.nodes.has(node.id)

    visits.push({
      node,
      parent,
      depth,
      collapsed: closed,
      head,
      hidden: closed ? countDescendants(node) : 0,
    })
    if (!closed) for (const kid of node.children) walk(kid, node, depth + 1)
  }
  for (const root of roots) walk(root, null, 0)

  // The head of a folded organization carries the count of what is behind it.
  for (const v of visits) {
    if (!v.head || !collapse.orgs.has(v.node.org)) continue
    const away = foldedAway.get(v.node.org)
    if (away) {
      v.collapsed = true
      v.hidden = away
    }
  }

  // Grouped by organization, first appearance first — which is the bishopric,
  // since the bishop is the root of the tree.
  const order: string[] = []
  const members = new Map<string, Visit[]>()
  for (const v of visits) {
    const list = members.get(v.node.org)
    if (list) list.push(v)
    else {
      members.set(v.node.org, [v])
      order.push(v.node.org)
    }
  }

  const clusterOf = new Map<string, string>(visits.map((v) => [v.node.id, v.node.org]))

  /** The organization a block reports to: the one holding its topmost node's parent. */
  const above = new Map<string, string | null>()
  for (const key of order) {
    const list = members.get(key)!
    const first = list.reduce((best, v) => (v.depth < best.depth ? v : best), list[0])
    const up = first.parent ? clusterOf.get(first.parent.id) : null
    above.set(key, up && up !== key ? up : null)
  }

  /** Levels between a block and the bishopric. Guarded, so a cycle cannot hang. */
  const depthOf = new Map<string, number>()
  for (const key of order) {
    let d = 0
    let cursor = above.get(key) ?? null
    const seen = new Set<string>([key])
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      d += 1
      cursor = above.get(cursor) ?? null
    }
    depthOf.set(key, d)
  }

  // Inside each block: an indented outline, wrapped into columns when it gets
  // long. Positions are relative to the block's own corner for now.
  const blocks = new Map<string, Block>()
  for (const key of order) {
    const list = members.get(key)!
    const base = Math.min(...list.map((v) => v.depth))

    const columns: Visit[][] = []
    for (let i = 0; i < list.length; i++) {
      const col = Math.floor(i / MAX_COL_ROWS)
      if (!columns[col]) columns[col] = []
      columns[col].push(list[i])
    }

    const level = (v: Visit) => Math.min(MAX_INDENT_LEVEL, v.depth - base)
    const colW = columns.map((col) => NODE_W + Math.max(...col.map((v) => level(v))) * INDENT)

    const placed: Placed[] = []
    columns.forEach((col, ci) => {
      const x0 = PAD_X + colW.slice(0, ci).reduce((sum, w) => sum + w + COL_GAP, 0)
      col.forEach((v, ri) => {
        placed.push({
          node: v.node,
          x: x0 + level(v) * INDENT,
          y: PAD_TOP + ri * (NODE_H + ROW_GAP),
          depth: v.depth,
          indent: level(v),
          cluster: key,
          head: v.head,
          collapsed: v.collapsed,
          hidden: v.hidden,
        })
      })
    })

    const rows = Math.max(...columns.map((c) => c.length))
    blocks.set(key, {
      key,
      placed,
      w: PAD_X * 2 + colW.reduce((sum, w) => sum + w, 0) + COL_GAP * (columns.length - 1),
      h: PAD_TOP + rows * (NODE_H + ROW_GAP) - ROW_GAP + PAD_BOTTOM,
      depth: depthOf.get(key)!,
      col: 0,
      laneIn: 0,
      laneOut: 0,
      laneBelow: 0,
    })
  }

  // Blocks onto the grid, level by level. Children of the same block stay near
  // it: within a level, blocks are ordered by where their parent block landed.
  const boxes = new Map<string, ClusterBox>()
  if (connected) {
    const levels = [...new Set(order.map((k) => depthOf.get(k)!))].sort((a, b) => a - b)

    /** Where a block ended up across the page, for ordering the band below it. */
    const acrossOf = (key: string) => boxes.get(key)?.x ?? Number.MAX_SAFE_INTEGER

    /** Which column a block ended up in, for pulling its children towards it. */
    const colOf = (key: string) => blocks.get(key)?.col ?? 0

    // A margin all round, so the blocks in the first column and the first band have
    // a corridor on the outside of them as well.
    const ORIGIN = CLUSTER_GAP

    // Every column of the grid is the same width, which is what makes the corridors
    // between them run clear from the top of the chart to the bottom.
    const widest = Math.max(...[...blocks.values()].map((b) => b.w))
    const gridCols = Math.max(1, Math.floor((MAX_BAND_W + CLUSTER_GAP) / (widest + CLUSTER_GAP)))
    const colAt = (col: number) => ORIGIN + col * (widest + CLUSTER_GAP)

    let bandBottom = 0

    for (const level of levels) {
      const keys = order.filter((k) => depthOf.get(k) === level)

      /** How many of this band's organizations answer to the same one. */
      const brood = new Map<string, number>()
      for (const key of keys) {
        const parent = above.get(key) ?? ''
        brood.set(parent, (brood.get(parent) ?? 0) + 1)
      }
      const siblings = (key: string) => brood.get(above.get(key) ?? '') ?? 1

      // An only child goes first: it has one column it is allowed in, and a crowd
      // of cousins spreading out of the column next door would otherwise take the
      // slot right under its parent.
      keys.sort((a, b) => {
        const pa = above.get(a)
        const pb = above.get(b)
        return (
          siblings(a) - siblings(b) ||
          (pa ? acrossOf(pa) : 0) - (pb ? acrossOf(pb) : 0) ||
          order.indexOf(a) - order.indexOf(b)
        )
      })

      // A band per level. Each block drops into the column that best trades off
      // being near its parent against how full that column already is.
      const bandTop = boxes.size === 0 ? 0 : bandBottom + CLUSTER_GAP * 1.5
      const nextY = new Array<number>(gridCols).fill(bandTop)

      for (const key of keys) {
        const block = blocks.get(key)!
        const parent = above.get(key)
        const want = parent ? colOf(parent) : 0
        const reach = reachFor(siblings(key))
        const from = Math.max(0, want - reach)
        const to = Math.min(gridCols - 1, want + reach)

        // The emptiest column within reach of the parent, and the nearest to it of
        // any that are equally empty.
        let col = from
        for (let i = from + 1; i <= to; i++) {
          if (
            nextY[i] < nextY[col] ||
            (nextY[i] === nextY[col] && Math.abs(i - want) < Math.abs(col - want))
          ) {
            col = i
          }
        }

        block.col = col
        block.laneIn = colAt(col) - CLUSTER_GAP / 2
        block.laneOut = colAt(col) + widest + CLUSTER_GAP / 2
        boxes.set(key, {
          key,
          x: colAt(col),
          y: nextY[col],
          w: block.w,
          h: block.h,
          depth: level,
          count: block.placed.length,
          folded: collapse.orgs.has(key),
        })
        nextY[col] += block.h + CLUSTER_GAP
      }

      bandBottom = Math.max(...nextY) - CLUSTER_GAP
      for (const key of keys) blocks.get(key)!.laneBelow = bandBottom + CLUSTER_GAP * 0.7
    }
  } else {
    // Packed: no lines to route, so no corridors and no bands. Blocks drop into
    // whichever column is shortest, in report order, which keeps the bishopric
    // top-left and everything else roughly where the connected chart had it.
    pack(order, blocks, depthOf, collapse, boxes)
  }

  // Block-relative positions become page positions.
  const nodes: Placed[] = []
  const byId = new Map<string, Placed>()
  for (const key of order) {
    const box = boxes.get(key)!
    for (const p of blocks.get(key)!.placed) {
      const moved = { ...p, x: p.x + box.x, y: p.y + box.y }
      nodes.push(moved)
      byId.set(moved.node.id, moved)
    }
  }

  // Lines. The ones sharing a corridor are spread across its width so they read
  // as a bundle of separate lines rather than one thick smear.
  type Pending = { id: string; from: Placed; to: Placed; cross: boolean; lane: string }
  const pending: Pending[] = []
  for (const v of connected ? visits : []) {
    if (!v.parent) continue
    const from = byId.get(v.parent.id)
    const to = byId.get(v.node.id)
    if (!from || !to) continue
    pending.push({
      id: `${v.parent.id}->${v.node.id}`,
      from,
      to,
      cross: from.cluster !== to.cluster,
      lane: `${from.cluster}->${blocks.get(to.cluster)!.col}`,
    })
  }

  const sharing = new Map<string, number>()
  for (const e of pending) {
    if (e.cross) sharing.set(e.lane, (sharing.get(e.lane) ?? 0) + 1)
  }
  const used = new Map<string, number>()

  const edges: Edge[] = pending.map((e) => {
    let offset = 0
    if (e.cross) {
      const total = sharing.get(e.lane) ?? 1
      const index = used.get(e.lane) ?? 0
      used.set(e.lane, index + 1)
      const step = Math.min(5, (CLUSTER_GAP * 0.55) / Math.max(1, total))
      offset = (index - (total - 1) / 2) * step
    }
    return {
      id: e.id,
      from: e.from,
      to: e.to,
      cross: e.cross,
      path: route(e.from, e.to, blocks, offset),
    }
  })

  const clusters = [...boxes.values()]
  return {
    nodes,
    edges,
    clusters,
    width: clusters.reduce((max, b) => Math.max(max, b.x + b.w), NODE_W) + CLUSTER_GAP,
    height: clusters.reduce((max, b) => Math.max(max, b.y + b.h), NODE_H) + CLUSTER_GAP,
  }
}

/**
 * Packed mode's placement: masonry, no hierarchy.
 *
 * Blocks are taken in report order — bishopric first — and each one dropped into
 * the column that is currently shortest, so a tall Primary next to a two-row
 * Nursery leaves no white hole under the short one. Column widths are measured
 * from what actually landed in them rather than fixed to the widest block on the
 * page, which is where most of the saved space comes from: an organization wide
 * enough to have wrapped into two inner columns no longer sets the gutter for
 * every single-column block beside it.
 *
 * The number of columns is chosen by trying them all and keeping whichever comes
 * closest to PACKED_ASPECT — there are a couple of dozen organizations in a ward
 * at most, so the search is free and it beats any fixed count across the range
 * from 'everything folded' to 'expand all'.
 */
function pack(
  order: string[],
  blocks: Map<string, Block>,
  depthOf: Map<string, number>,
  collapse: Collapse,
  into: Map<string, ClusterBox>,
): void {
  /** One attempt: blocks into `cols` columns, and the page it comes out as. */
  const attempt = (cols: number) => {
    const heights = new Array<number>(cols).fill(0)
    const columns: string[][] = Array.from({ length: cols }, () => [])
    for (const key of order) {
      let pick = 0
      for (let i = 1; i < cols; i++) if (heights[i] < heights[pick]) pick = i
      columns[pick].push(key)
      heights[pick] += blocks.get(key)!.h + PACKED_GAP
    }
    const widths = columns.map((col) =>
      col.length ? Math.max(...col.map((k) => blocks.get(k)!.w)) : 0,
    )
    const used = widths.filter((w) => w > 0)
    return {
      columns,
      widths,
      w: used.reduce((sum, w) => sum + w, 0) + PACKED_GAP * Math.max(0, used.length - 1),
      h: Math.max(...heights) - PACKED_GAP,
    }
  }

  let best = attempt(1)
  for (let cols = 2; cols <= order.length; cols++) {
    const tried = attempt(cols)
    if (
      Math.abs(tried.w / tried.h - PACKED_ASPECT) < Math.abs(best.w / best.h - PACKED_ASPECT)
    ) {
      best = tried
    }
  }

  // A margin all round, matching what the connected chart leaves.
  let x = PACKED_GAP
  best.columns.forEach((col, i) => {
    if (!col.length) return
    let y = PACKED_GAP
    for (const key of col) {
      const block = blocks.get(key)!
      into.set(key, {
        key,
        x,
        y,
        w: block.w,
        h: block.h,
        depth: depthOf.get(key)!,
        count: block.placed.length,
        folded: collapse.orgs.has(key),
      })
      y += block.h + PACKED_GAP
    }
    x += best.widths[i] + PACKED_GAP
  })
}

/**
 * An orthogonal path with rounded corners: straight runs, soft bends — which is
 * what makes a line that has been round three sides of an organization still
 * easy to follow with an eye.
 */
function bendy(points: [number, number][], r = BEND): string {
  const pts = points.filter(
    (p, i) =>
      i === 0 || Math.abs(p[0] - points[i - 1][0]) > 0.5 || Math.abs(p[1] - points[i - 1][1]) > 0.5,
  )
  if (pts.length < 2) return ''

  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]
    const [cx, cy] = pts[i]
    const [nx, ny] = pts[i + 1]
    const inLen = Math.hypot(cx - px, cy - py) || 1
    const outLen = Math.hypot(nx - cx, ny - cy) || 1
    const bend = Math.min(r, inLen / 2, outLen / 2)
    const ax = cx - ((cx - px) / inLen) * bend
    const ay = cy - ((cy - py) / inLen) * bend
    const bx = cx + ((nx - cx) / outLen) * bend
    const by = cy + ((ny - cy) / outLen) * bend
    d += ` L ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`
  }
  const last = pts[pts.length - 1]
  return `${d} L ${last[0]} ${last[1]}`
}

/**
 * One line, routed clear of every block.
 *
 * Inside a block it is an outline elbow: down the parent's left rail, round the
 * corner, into the child. Between blocks it leaves through the side of the box —
 * never the bottom, since a leader is the top row of his block and dropping
 * straight down would run the line behind his own counsellors — out into the
 * corridor beside his organization, along it, and back in through the side of the
 * organization it is going to.
 */
function route(from: Placed, to: Placed, blocks: Map<string, Block>, offset: number): string {
  const railX = from.x + 14
  if (
    from.cluster === to.cluster &&
    to.y >= from.y + NODE_H - 1 &&
    to.x >= railX &&
    to.x <= from.x + NODE_W
  ) {
    return bendy(
      [
        [railX, from.y + NODE_H],
        [railX, to.y + NODE_H / 2],
        [to.x, to.y + NODE_H / 2],
      ],
      8,
    )
  }

  const a = blocks.get(from.cluster)!
  const b = blocks.get(to.cluster)!
  const y1 = from.y + NODE_H / 2
  const y2 = to.y + NODE_H / 2

  // Out to the right, unless the target's organization sits further left.
  const back = b.col < a.col
  const exitX = back ? from.x : from.x + NODE_W
  const escape = (back ? a.laneIn : a.laneOut) + offset

  // Out to the corridor beside the parent's column, down it, across the empty band
  // between the two levels, then down the corridor beside the target's column and
  // in through its side.
  const enterLeft = b.col > a.col
  const enter = (enterLeft ? b.laneIn : b.laneOut) + (b.col === a.col ? offset : 0)
  const entryX = enterLeft ? to.x : to.x + NODE_W

  return bendy([
    [exitX, y1],
    [escape, y1],
    [escape, a.laneBelow + offset],
    [enter, a.laneBelow + offset],
    [enter, y2],
    [entryX, y2],
  ])
}
