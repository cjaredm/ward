/**
 * Exercises the org-chart hierarchy builder. No database, invented names.
 *
 *   npx tsx scripts/test-org-tree.ts
 */
import { buildOrgTree, type TreeNode } from '../src/lib/org-tree'
import { ROWS } from './fixtures/callings-rows'
import { run } from './lib/run'

/** Depth-first path of titles, for assertions that read like the chart looks. */
function paths(nodes: TreeNode[], prefix: string[] = []): string[] {
  return nodes.flatMap((node) => {
    const here = [...prefix, node.title]
    return [here.join(' > '), ...paths(node.children, here)]
  })
}

const EXPECT = [
  'Bishop > Bishopric First Counselor',
  'Bishop > Ward Clerk',
  'Bishop > Ward Assistant Clerk',
  'Bishop > Elders Quorum President > Elders Quorum First Counselor',
  'Bishop > Elders Quorum President > Elders Quorum Secretary > Elders Quorum Assistant Secretary',
  'Bishop > Elders Quorum President > Teachers > Elders Quorum Teacher',
  'Bishop > Deacons Quorum President > Deacons Quorum Adult Leaders > Deacons Quorum Adviser',
  'Bishop > Young Women President > Gatherers of Light Class President',
  'Bishop > Primary President > Valiant 9 > Primary Teacher',
]

run(async () => {
  const roots = buildOrgTree(ROWS)
  const all = paths(roots)
  for (const p of all) console.log(p)

  const failures: string[] = []
  if (roots.length !== 1) failures.push(`${roots.length} roots, expected 1 (the bishop)`)
  for (const want of EXPECT) {
    if (!all.includes(want)) failures.push(`missing path: ${want}`)
  }
  // Nothing may be dropped, and nothing may appear twice.
  const leaves = all.filter((p) => !all.some((q) => q !== p && q.startsWith(`${p} >`)))
  const nodeCount = new Set(all).size
  if (nodeCount < ROWS.length) failures.push(`${nodeCount} nodes for ${ROWS.length} callings`)
  if (leaves.length === 0) failures.push('no leaves')

  console.log()
  if (failures.length > 0) {
    for (const f of failures) console.log(`FAIL  ${f}`)
    process.exitCode = 1
    return
  }
  console.log(`ok — ${EXPECT.length} paths present`)
})
