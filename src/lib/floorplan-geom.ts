/**
 * Polygon maths for the building map, in the floorplan's own coordinate space.
 *
 * Deliberately not PostGIS, and deliberately not in SQL. A room outline is a
 * ring of SVG user units on a 2252x1183 canvas with **Y pointing down**; there
 * is no SRID that is honest about that. The hazard is not that PostGIS would
 * fail — it is that it would appear to work: ST_Area(geom::geography) on these
 * numbers returns a plausible figure that means nothing, ST_MakeValid would
 * repair "degrees", and winding semantics are inverted against SVG's. So the
 * geometry lives in jsonb and the maths lives here, where a test script can
 * import it without a browser or a database.
 *
 * Rings are stored and passed **open**: the closing point is implied. That way
 * a reshape cannot leave a stale duplicate of the first vertex behind.
 */

export type Pt = [number, number]

/** Coordinates are rounded to this many decimals everywhere. A tenth of a unit. */
const DP = 1

function round(n: number): number {
  const f = 10 ** DP
  return Math.round(n * f) / f
}

/**
 * Reads the `d` of one of the drawing's room paths into an open ring.
 *
 * Accepts only M/L/Z, absolute or relative, separated by commas or whitespace —
 * which is exactly what the tracing tool emits and what the starter drawing
 * contains. Anything curved **throws** rather than being approximated: a cubic
 * that silently became four straight lines would round-trip differently every
 * time it was saved, and the vertex editor has no handles to offer for it.
 */
export function parsePathD(d: string): Pt[] {
  const tokens = d.match(/[MmLlZzHhVvCcSsQqTtAa]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi)
  if (!tokens) throw new Error('Empty path')

  const points: Pt[] = []
  let cmd = ''
  let x = 0
  let y = 0
  let i = 0

  const next = (): number => {
    const t = tokens[i++]
    if (t === undefined) throw new Error(`Path ended mid-command after ${cmd}`)
    const n = Number(t)
    if (!Number.isFinite(n)) throw new Error(`Expected a number in path, got '${t}'`)
    return n
  }

  while (i < tokens.length) {
    const token = tokens[i]
    if (/^[A-Za-z]$/.test(token)) {
      cmd = token
      i++
      if (cmd === 'Z' || cmd === 'z') continue
      if (!'MmLl'.includes(cmd)) {
        throw new Error(`Unsupported path command '${cmd}' — only M, L and Z are handled`)
      }
    } else if (!cmd) {
      throw new Error('Path does not start with a command')
    }

    // A repeated coordinate pair after M continues as an implicit L, per SVG.
    const relative = cmd === cmd.toLowerCase()
    const dx = next()
    const dy = next()
    x = relative ? x + dx : dx
    y = relative ? y + dy : dy
    points.push([round(x), round(y)])
    if (cmd === 'M') cmd = 'L'
    else if (cmd === 'm') cmd = 'l'
  }

  return normalizeRing(points)
}

/** The ring as an SVG path, closed. */
export function toPathD(points: Pt[]): string {
  if (points.length === 0) return ''
  const [first, ...rest] = points
  const pair = (p: Pt) => `${round(p[0])},${round(p[1])}`
  return `M${pair(first)}${rest.length ? ` L${rest.map(pair).join(' ')}` : ''} Z`
}

/**
 * One canonical shape for a ring, whatever drew it.
 *
 * Called by the seed *and* by every write route, so geometry in the database
 * never depends on whether a path was hand-typed, traced clockwise, or traced
 * anticlockwise. Idempotent: normalising a normalised ring is a no-op.
 */
export function normalizeRing(points: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const [px, py] of points) {
    const p: Pt = [round(px), round(py)]
    const last = out[out.length - 1]
    // Consecutive near-duplicates come from a double-tap on the same corner.
    if (last && Math.abs(last[0] - p[0]) < 0.15 && Math.abs(last[1] - p[1]) < 0.15) continue
    out.push(p)
  }
  // An explicitly closed ring arrives with its first point repeated at the end.
  while (out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (Math.abs(first[0] - last[0]) < 0.15 && Math.abs(first[1] - last[1]) < 0.15) out.pop()
    else break
  }
  // Clockwise in SVG's Y-down space, which is a positive shoelace sum here.
  if (out.length >= 3 && signedArea(out) < 0) out.reverse()
  return out
}

/**
 * Twice the signed area, by the shoelace sum. Positive is clockwise on screen,
 * because Y grows downwards.
 */
export function signedArea(points: Pt[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    sum += x1 * y2 - x2 * y1
  }
  return sum
}

/** Enclosed area in square floorplan units, whichever way the ring was drawn. */
export function area(points: Pt[]): number {
  return Math.abs(signedArea(points)) / 2
}

export function bbox(points: Pt[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * The polygon's area centroid — *not* the mean of its vertices.
 *
 * The mean is pulled towards whichever wall was traced with the most points, and
 * most rooms in this drawing have one wall of six points opposite a wall of two.
 * It is also the wrong answer entirely for the L-shaped rooms.
 */
export function centroid(points: Pt[]): Pt {
  const a = signedArea(points)
  if (a === 0) {
    // A degenerate ring has no centroid; the bbox middle is the honest fallback.
    const b = bbox(points)
    return [round(b.x + b.w / 2), round(b.y + b.h / 2)]
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    const cross = x1 * y2 - x2 * y1
    cx += (x1 + x2) * cross
    cy += (y1 + y2) * cross
  }
  return [round(cx / (3 * a)), round(cy / (3 * a))]
}

/** Ray cast, counting crossings to the right of the point. Edges count as inside. */
export function pointInPolygon(points: Pt[], [x, y]: Pt): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * Where a room's label hangs.
 *
 * The centroid when it lands inside the room, which covers every rectangle. When
 * it does not — the L-shaped foyer, the U-shaped cultural hall wrapped around
 * the stage — the centroid is out in a corridor, and a label floating outside
 * its own walls is worse than no label. The fallback is the middle of the widest
 * horizontal chord the polygon actually contains, which is both inside the room
 * and in its roomiest part, so the text has somewhere to go.
 */
export function labelAnchor(points: Pt[]): Pt {
  const c = centroid(points)
  if (pointInPolygon(points, c)) return c

  const box = bbox(points)
  let best: Pt = c
  let bestWidth = -1
  // Eleven scanlines is enough to find the fat part of a room and cheap enough
  // to run for every room on every load.
  for (let step = 1; step <= 11; step++) {
    const y = box.y + (box.h * step) / 12
    const xs = crossings(points, y)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const width = xs[i + 1] - xs[i]
      if (width > bestWidth) {
        bestWidth = width
        best = [round((xs[i] + xs[i + 1]) / 2), round(y)]
      }
    }
  }
  return best
}

/** Sorted x positions where the ring crosses a horizontal line. */
function crossings(points: Pt[], y: number): number[] {
  const xs: number[] = []
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi)
  }
  return xs.sort((a, b) => a - b)
}

/** The fewest corners that still enclose an area. */
export const MIN_VERTICES = 3

/**
 * Whether the corner at `index` can go.
 *
 * Shared by the Remove point button and the Backspace/Delete keys so the two can
 * never disagree about when a corner is removable — which they would, eventually,
 * as two copies of `points.length <= 3`.
 *
 * `min` is the floor the ring must still clear afterwards. It is MIN_VERTICES for
 * a saved room, which has to keep enclosing an area, and 0 for an outline still
 * being traced, where going back down to nothing is how somebody starts over.
 */
export function canRemoveVertex(points: Pt[], index: number | null, min = MIN_VERTICES): boolean {
  if (index === null) return false
  if (index < 0 || index >= points.length) return false
  return points.length > min
}

/**
 * The ring without the corner at `index`.
 *
 * Returns the ring untouched when removing that corner would take it below `min`,
 * so a caller that forgot to check cannot destroy a room.
 */
export function removeVertex(points: Pt[], index: number | null, min = MIN_VERTICES): Pt[] {
  if (!canRemoveVertex(points, index, min)) return points
  return points.filter((_, i) => i !== index)
}

/** Midpoint of the edge that starts at `i`, for the "insert a corner" handles. */
export function edgeMidpoint(points: Pt[], i: number): Pt {
  const [x1, y1] = points[i]
  const [x2, y2] = points[(i + 1) % points.length]
  return [round((x1 + x2) / 2), round((y1 + y2) / 2)]
}
