/**
 * Exercises the building map's polygon maths. No database, no browser.
 *
 *   npx tsx scripts/test-floorplan-geom.ts
 */
import {
  MIN_VERTICES,
  area,
  bbox,
  canRemoveVertex,
  centroid,
  edgeMidpoint,
  labelAnchor,
  normalizeRing,
  parsePathD,
  pointInPolygon,
  removeVertex,
  signedArea,
  toPathD,
  type Pt,
} from '../src/lib/floorplan-geom'
import { run } from './lib/run'

/** A plain rectangle, traced clockwise on screen. */
const RECT: Pt[] = [
  [10, 20],
  [110, 20],
  [110, 70],
  [10, 70],
]

/**
 * An L with thin arms. Its area centroid lands out in the notch, outside its own
 * walls, which is the whole reason `labelAnchor` exists.
 *
 * The arms have to be thin for that: widen them and the centroid creeps back
 * inside the corner, which is why a fatter L is a useless test of this.
 */
const ELL: Pt[] = [
  [0, 0],
  [100, 0],
  [100, 20],
  [20, 20],
  [20, 100],
  [0, 100],
]

/**
 * The real 'Cultural Center One' outline from the starter drawing, including the
 * circular column bulge traced as a run of short segments. Round-tripping this
 * is the correctness proof for the seed.
 */
const CULTURAL_CENTER_ONE =
  'M850.0,408.0 L850.0,775.3 L912.3,775.3 L912.7,804.0 L1210.7,804.0 L1210.7,645.0 ' +
  'L1198.3,643.3 L1184.3,638.7 L1184.0,637.0 L1173.7,629.7 L1164.3,617.3 L1157.7,598.0 ' +
  'L1157.7,585.3 L1159.3,578.0 L1164.7,565.3 L1172.0,555.3 L1184.3,544.3 L1198.3,540.0 ' +
  'L1210.7,538.3 L1210.7,379.3 L912.7,379.3 L912.3,408.0 Z'

/**
 * The real room 116 outline: an L wrapping round the corridor, 23 corners, and
 * genuinely concave. The kind of room the label ladder has to cope with.
 */
const ROOM_116 =
  'M1113.3,945.7 L1113.3,977.3 L1131.0,978.0 L1131.0,1006.3 L1139.0,1007.7 L1148.0,1012.7 ' +
  'L1153.7,1019.0 L1156.7,1025.3 L1157.3,1055.7 L1286.0,1055.7 L1286.3,1043.7 L1291.0,1034.7 ' +
  'L1299.0,1028.0 L1312.0,1024.3 L1312.0,945.7 L1300.0,945.3 L1291.0,940.7 L1284.3,933.0 ' +
  'L1280.7,919.3 L1162.3,919.3 L1161.3,927.3 L1158.7,933.0 L1148.7,943.0 L1141.3,945.7 Z'

run(async () => {
  const failures: string[] = []
  const check = (cond: boolean, why: string) => {
    if (!cond) failures.push(why)
  }

  // --- parsePathD / toPathD -------------------------------------------------
  const parsed = parsePathD(CULTURAL_CENTER_ONE)
  check(parsed.length === 22, `the cultural hall should parse to 22 corners, got ${parsed.length}`)
  const round1 = parsePathD(toPathD(parsed))
  check(
    JSON.stringify(round1) === JSON.stringify(parsed),
    'parse -> serialize -> parse should be the identity on a real room outline',
  )

  check(
    JSON.stringify(parsePathD('M0,0 L10,0 L10,10 L0,10 Z')) ===
      JSON.stringify([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
    'a simple closed square should parse to four corners with no repeat',
  )

  // Relative commands, and an implicit L after M — both legal SVG the tracer or
  // a hand-edited path could produce.
  check(
    JSON.stringify(parsePathD('m0,0 l10,0 l0,10 l-10,0 z')) ===
      JSON.stringify([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
    'relative m/l should resolve to the same absolute ring',
  )
  check(
    parsePathD('M0,0 10,0 10,10 0,10 Z').length === 4,
    'a repeated coordinate pair after M should continue as an implicit L',
  )

  let threw = false
  try {
    parsePathD('M0,0 C10,10 20,20 30,30 Z')
  } catch {
    threw = true
  }
  check(threw, 'a curve command must throw rather than be flattened silently')

  // --- normalizeRing --------------------------------------------------------
  const closed: Pt[] = [...RECT, [10, 20]]
  check(normalizeRing(closed).length === 4, 'an explicitly closed ring should come back open')
  const dupes: Pt[] = [
    [10, 20],
    [10, 20],
    [110, 20],
    [110, 70],
    [10, 70],
  ]
  check(
    normalizeRing(dupes).length === 4,
    'a double-tapped corner should collapse to one vertex',
  )
  const once = normalizeRing(ELL)
  check(
    JSON.stringify(normalizeRing(once)) === JSON.stringify(once),
    'normalizeRing must be idempotent',
  )
  check(
    signedArea(normalizeRing([...RECT].reverse())) > 0,
    'a ring traced anticlockwise should be flipped to the canonical winding',
  )

  // --- area / bbox ----------------------------------------------------------
  check(area(RECT) === 5000, `a 100x50 rectangle should have area 5000, got ${area(RECT)}`)
  check(
    area(RECT) === area([...RECT].reverse()),
    'area should not depend on which way the ring was drawn',
  )
  check(area([[0, 0], [10, 0], [20, 0]]) === 0, 'three collinear points enclose no area')

  const box = bbox(RECT)
  check(
    box.x === 10 && box.y === 20 && box.w === 100 && box.h === 50,
    `bbox of the rectangle should be 10,20 100x50, got ${JSON.stringify(box)}`,
  )

  // --- centroid / pointInPolygon / labelAnchor -------------------------------
  check(
    JSON.stringify(centroid(RECT)) === JSON.stringify([60, 45]),
    `the rectangle's centroid should be its middle, got ${JSON.stringify(centroid(RECT))}`,
  )
  check(pointInPolygon(RECT, [60, 45]), 'the middle of a rectangle is inside it')
  check(!pointInPolygon(RECT, [0, 0]), 'a point outside the rectangle is outside it')

  // The point of the whole exercise: on an L the centroid escapes the polygon
  // and labelAnchor has to put the text back inside it.
  check(!pointInPolygon(ELL, centroid(ELL)), "the L's area centroid should fall outside it")
  check(
    pointInPolygon(ELL, labelAnchor(ELL)),
    'labelAnchor must land inside an L-shaped room',
  )
  check(
    JSON.stringify(labelAnchor(RECT)) === JSON.stringify(centroid(RECT)),
    'on a convex room labelAnchor should just be the centroid',
  )
  check(
    pointInPolygon(parsed, labelAnchor(parsed)),
    'labelAnchor must land inside the real cultural hall outline',
  )

  const r116 = parsePathD(ROOM_116)
  check(r116.length === 24, `room 116 should parse to 24 corners, got ${r116.length}`)
  check(
    JSON.stringify(parsePathD(toPathD(r116))) === JSON.stringify(r116),
    'room 116 should round-trip through the path serializer unchanged',
  )
  check(
    pointInPolygon(r116, labelAnchor(r116)),
    'labelAnchor must land inside the real room 116 outline',
  )
  check(area(r116) > 10000, `room 116 should enclose a real area, got ${Math.round(area(r116))}`)

  // --- edgeMidpoint ---------------------------------------------------------
  check(
    JSON.stringify(edgeMidpoint(RECT, 0)) === JSON.stringify([60, 20]),
    'the midpoint of the first edge is halfway along the top wall',
  )
  check(
    JSON.stringify(edgeMidpoint(RECT, 3)) === JSON.stringify([10, 45]),
    'the last edge wraps back to the first vertex',
  )

  // --- removing a corner ----------------------------------------------------
  // One rule, shared by the Remove point button and the Backspace/Delete keys.
  const five: Pt[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [5, 14],
    [0, 10],
  ]
  check(canRemoveVertex(five, 2), 'a five-corner room can lose one')
  check(
    JSON.stringify(removeVertex(five, 2)) ===
      JSON.stringify([
        [0, 0],
        [10, 0],
        [5, 14],
        [0, 10],
      ]),
    'removing corner 2 should drop exactly that corner',
  )
  check(removeVertex(five, 0).length === 4, 'the first corner is removable like any other')
  check(removeVertex(five, 4).length === 4, 'so is the last')

  // The floor the user asked for: three corners must survive.
  check(!canRemoveVertex(RECT.slice(0, 3), 1), 'a three-corner room cannot lose one')
  check(
    removeVertex(RECT.slice(0, 3), 1).length === 3,
    'and asking anyway must leave the ring untouched rather than destroying it',
  )
  check(canRemoveVertex(RECT, 1), 'a four-corner room can lose one, leaving three')
  check(removeVertex(RECT, 1).length === MIN_VERTICES, 'which lands exactly on the floor')

  check(!canRemoveVertex(five, null), 'nothing selected means nothing to remove')
  check(removeVertex(five, null).length === 5, 'and the ring is returned untouched')
  check(!canRemoveVertex(five, 9), 'an index past the end is not removable')
  check(!canRemoveVertex(five, -1), 'nor is a negative one')

  // While tracing there is no floor: deleting back to nothing is how somebody
  // starts the outline over.
  check(
    canRemoveVertex(RECT.slice(0, 3), 1, 0),
    'a traced outline of three corners can still lose one',
  )
  check(removeVertex([[1, 1]], 0, 0).length === 0, 'the last traced corner can go too')
  check(!canRemoveVertex([], 0, 0), 'an empty ring has nothing to remove')

  console.log()
  if (failures.length > 0) {
    for (const f of failures) console.log(`FAIL  ${f}`)
    process.exitCode = 1
    return
  }
  console.log('ok — floorplan geometry')
})
