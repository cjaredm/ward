/**
 * Checks the org chart's geometry without a browser.
 *
 * The chart's promise is that an organization reads as one thing and that the
 * bishopric is the first thing on screen, so that is what is asserted: no box
 * overlaps another, every box sits inside its own organization's shape, the
 * shapes do not overlap each other, and the bishopric block is at the top-left
 * corner in both orientations.
 *
 *   npx tsx scripts/test-org-layout.ts
 */
import { NODE_H, NODE_W, layout, orgsIn, presidencies, type Collapse } from '../src/lib/org-layout'
import { buildOrgTree, type CallingRecord } from '../src/lib/org-tree'
import { ROWS } from './fixtures/callings-rows'
import { WARD_ROWS } from './fixtures/callings-ward'
import { run } from './lib/run'

type Box = { x: number; y: number; w: number; h: number }

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const inside = (a: Box, b: Box) =>
  a.x >= b.x - 0.5 &&
  a.y >= b.y - 0.5 &&
  a.x + a.w <= b.x + b.w + 0.5 &&
  a.y + a.h <= b.y + b.h + 0.5

/**
 * Points along a routed path. Enough of an SVG path reader for the three commands
 * the layout emits — move, line, quadratic bend — so a test can ask where a line
 * actually goes.
 */
function samples(d: string, step = 6): [number, number][] {
  const tokens = d.match(/[MLQ]|-?\d+(?:\.\d+)?/g) ?? []
  const points: [number, number][] = []
  let at: [number, number] = [0, 0]
  let i = 0

  const line = (to: [number, number]) => {
    const n = Math.max(1, Math.ceil(Math.hypot(to[0] - at[0], to[1] - at[1]) / step))
    for (let k = 1; k <= n; k++) {
      points.push([at[0] + ((to[0] - at[0]) * k) / n, at[1] + ((to[1] - at[1]) * k) / n])
    }
    at = to
  }

  while (i < tokens.length) {
    const cmd = tokens[i++]
    if (cmd === 'M') {
      at = [Number(tokens[i++]), Number(tokens[i++])]
      points.push(at)
    } else if (cmd === 'L') {
      line([Number(tokens[i++]), Number(tokens[i++])])
    } else if (cmd === 'Q') {
      const cx = Number(tokens[i++])
      const cy = Number(tokens[i++])
      const x = Number(tokens[i++])
      const y = Number(tokens[i++])
      const from = at
      for (let k = 1; k <= 6; k++) {
        const t = k / 6
        const u = 1 - t
        points.push([
          u * u * from[0] + 2 * u * t * cx + t * t * x,
          u * u * from[1] + 2 * u * t * cy + t * t * y,
        ])
      }
      at = [x, y]
    } else {
      break
    }
  }
  return points
}

run(async () => {
  const failures: string[] = []
  audit('small ward', ROWS, failures)
  audit('full ward', WARD_ROWS, failures)

  console.log()
  if (failures.length > 0) {
    for (const f of failures) console.log(`FAIL  ${f}`)
    process.exitCode = 1
    return
  }
  console.log('ok — orgs stay together, lines go round them, and the bishopric leads')
})

function audit(ward: string, rows: CallingRecord[], failures: string[]): void {
  console.log(`\n${ward}`)
  const roots = buildOrgTree(rows)

  function check(name: string, collapsed: Collapse, connected = true) {
    const label = `${ward}, ${name}`
    const { nodes, edges, clusters, width, height } = layout(roots, collapsed, connected)
    console.log(
      `${label}: ${nodes.length} boxes in ${clusters.length} orgs, ${edges.length} lines, ${width}×${height}`,
    )

    const boxOf = (p: (typeof nodes)[number]): Box => ({ x: p.x, y: p.y, w: NODE_W, h: NODE_H })

    // No box may touch another, anywhere on the page.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (overlaps(boxOf(nodes[i]), boxOf(nodes[j]))) {
          failures.push(`${label}: ${nodes[i].node.title} overlaps ${nodes[j].node.title}`)
        }
      }
    }

    // Nor may two organizations' shapes.
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (overlaps(clusters[i], clusters[j])) {
          failures.push(`${label}: org shapes ${clusters[i].key} and ${clusters[j].key} overlap`)
        }
      }
    }

    // Every box sits inside the shape drawn for its own organization.
    const shape = new Map(clusters.map((c) => [c.key, c]))
    for (const p of nodes) {
      const c = shape.get(p.cluster)
      if (!c) {
        failures.push(`${label}: ${p.node.title} has no org shape`)
        continue
      }
      if (!inside(boxOf(p), c)) {
        failures.push(`${label}: ${p.node.title} sticks out of the ${c.key} shape`)
      }
    }

    // The bishopric is the top-left corner of the chart, whichever way it grows.
    const bishopric = shape.get('bishopric')
    if (!bishopric) failures.push(`${label}: no bishopric shape`)
    else {
      const leftmost = Math.min(...clusters.map((c) => c.x))
      const topmost = Math.min(...clusters.map((c) => c.y))
      if (bishopric.x > leftmost) failures.push(`${label}: bishopric is not the leftmost org`)
      if (bishopric.y > topmost) failures.push(`${label}: bishopric is not the topmost org`)
      // And it is one tight block, not a row of six boxes spread across the page.
      if (bishopric.w > NODE_W * 1.6) {
        failures.push(`${label}: bishopric block is ${bishopric.w} wide, expected one column`)
      }
      const members = nodes.filter((p) => p.cluster === 'bishopric')
      const wanted = [
        'Bishop',
        'Bishopric First Counselor',
        'Bishopric Second Counselor',
        'Ward Executive Secretary',
        'Ward Clerk',
      ]
      for (const title of wanted) {
        if (!members.some((p) => p.node.title === title)) {
          failures.push(`${label}: ${title} is not in the bishopric block`)
        }
      }
    }

    // No organization is drawn twice, and nothing is dropped.
    if (new Set(clusters.map((c) => c.key)).size !== clusters.length) {
      failures.push(`${label}: an org has more than one shape`)
    }
    const counted = clusters.reduce((sum, c) => sum + c.count, 0)
    if (counted !== nodes.length) {
      failures.push(`${label}: shapes account for ${counted} boxes, ${nodes.length} placed`)
    }

    // No line may cross an organization it has nothing to do with. Lines are
    // routed down the corridors between the blocks precisely so that a Primary
    // teacher's box never has somebody else's reporting line drawn over it.
    for (const e of edges) {
      const own = new Set([e.from.cluster, e.to.cluster])
      const points = samples(e.path)
      for (const c of clusters) {
        if (own.has(c.key)) continue
        const hit = points.find(
          ([x, y]) => x > c.x + 1 && x < c.x + c.w - 1 && y > c.y + 1 && y < c.y + c.h - 1,
        )
        if (hit) {
          failures.push(
            `${label}: the line ${e.from.node.title} → ${e.to.node.title} crosses ${c.key}`,
          )
          break
        }
      }
    }

    // Packed mode draws no lines at all — that is the whole of what it is — so
    // the reachability rule below is a connected-mode rule.
    if (!connected) {
      if (edges.length > 0) failures.push(`${label}: packed mode drew ${edges.length} lines`)
      return nodes
    }

    // Every placed node is reachable by a line, except the roots.
    const rootIds = new Set(roots.map((r) => r.id))
    const withParent = new Set(edges.map((e) => e.to.node.id))
    for (const p of nodes) {
      if (!rootIds.has(p.node.id) && !withParent.has(p.node.id))
        failures.push(`${label}: ${p.node.title} has no line to it`)
    }

    return nodes
  }

  const open: Collapse = { orgs: new Set(), nodes: new Set() }
  const presidenciesOnly: Collapse = { orgs: new Set(orgsIn(roots)), nodes: new Set() }
  /** What the page opens on: every organization folded but the bishopric. */
  const opening: Collapse = {
    orgs: new Set(orgsIn(roots).filter((k) => k !== 'bishopric')),
    nodes: new Set(),
  }

  const expanded = check('expanded', open)
  const folded = check('presidencies only', presidenciesOnly)
  const first = check('the opening view', opening)

  // Packed mode holds the same boxes on less page. Every geometry rule above
  // still applies — nothing overlaps, every box is inside its own organization —
  // and on top of that it has to actually be tighter, or there is no reason for
  // the switch to exist.
  for (const [name, collapsed] of [
    ['packed, expanded', open],
    ['packed, the opening view', opening],
  ] as const) {
    const loose = layout(roots, collapsed, true)
    const tight = layout(roots, collapsed, false)
    check(name, collapsed, false)
    if (tight.nodes.length !== loose.nodes.length) {
      failures.push(`${ward}, ${name}: ${tight.nodes.length} boxes, connected has ${loose.nodes.length}`)
    }
    if (tight.width * tight.height >= loose.width * loose.height) {
      failures.push(
        `${ward}, ${name}: ${tight.width}×${tight.height} is no tighter than ${loose.width}×${loose.height}`,
      )
    }
  }

  // A child organization belongs beside its parent. Several of them have to
  // spread out — a dozen cannot all share one column without the chart becoming a
  // single strip a mile long — but n children never need more than n columns, so
  // none of them has any business more than half that from its parent. An only
  // child has no excuse at all: the Nursery goes in Primary's own column.
  const boxes = layout(roots, opening)
  const shape = new Map(boxes.clusters.map((c) => [c.key, c]))
  const column = Math.max(...boxes.clusters.map((c) => c.w)) + 44
  const left = Math.min(...boxes.clusters.map((c) => c.x))
  const columnOf = (key: string) => Math.round((shape.get(key)!.x - left) / column)

  const brood = new Map<string, Set<string>>()
  for (const e of boxes.edges) {
    if (!e.cross) continue
    const set = brood.get(e.from.cluster)
    if (set) set.add(e.to.cluster)
    else brood.set(e.from.cluster, new Set([e.to.cluster]))
  }

  for (const [parent, children] of brood) {
    const allowed = Math.ceil(children.size / 2)
    for (const child of children) {
      const apart = Math.abs(columnOf(child) - columnOf(parent))
      if (apart > allowed) {
        failures.push(
          `${ward}: ${child} sits ${apart} columns from ${parent}, which has ${children.size} child orgs`,
        )
      }
    }
  }

  if (folded.length >= expanded.length) failures.push('folding the organizations hid nothing')
  const hiding = folded.filter((p) => p.collapsed)
  if (hiding.length === 0 || hiding.some((p) => p.hidden === 0)) {
    failures.push('a folded box is not reporting what it hides')
  }

  // A folded organization still shows its whole presidency, not just its leader:
  // that is the point of the opening view.
  const pres = presidencies(roots)
  for (const [org, ids] of pres) {
    const shown = new Set(folded.filter((p) => p.cluster === org).map((p) => p.node.id))
    for (const id of ids) {
      if (!shown.has(id)) failures.push(`presidency member ${id} missing from folded ${org}`)
    }
    const extra = [...shown].filter((id) => !ids.has(id))
    if (extra.length > 0) failures.push(`folded ${org} is showing ${extra.length} boxes too many`)
  }
  const eq = folded.filter((p) => p.cluster === 'elders_quorum').map((p) => p.node.title)
  for (const want of [
    'Elders Quorum President',
    'Elders Quorum First Counselor',
    'Elders Quorum Secretary',
  ]) {
    if (!eq.includes(want)) failures.push(`folded Elders Quorum is missing the ${want}`)
  }

  // The opening view shows the bishopric whole and every other presidency.
  const openingBishopric = first.filter((p) => p.cluster === 'bishopric')
  if (openingBishopric.length !== expanded.filter((p) => p.cluster === 'bishopric').length) {
    failures.push('the opening view does not show the whole bishopric')
  }
  if (first.some((p) => p.cluster === 'primary' && p.node.kind === 'group')) {
    failures.push('the opening view is showing sub-headings inside a folded organization')
  }
}
