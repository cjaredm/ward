/**
 * Turns a flat list of callings into the ward's line of authority.
 *
 * The LCR report knows which organization a calling sits in and nothing about
 * who reports to whom, so the hierarchy is derived from the calling names, which
 * are standardized enough to carry it:
 *
 *   Bishop                                   the root
 *     Bishopric First Counselor              counselors of the bishopric
 *     Ward Clerk, Executive Secretary        bishopric staff
 *     Elders Quorum President                every organization's leader
 *       Elders Quorum First Counselor        that organization's counselors
 *       Elders Quorum Secretary              and its secretary
 *         Elders Quorum Assistant Secretary  assistants under the one they assist
 *       Teachers · Ministering · Activities  everyone else, grouped by the
 *                                            sub-heading they were printed under
 *     Deacons Quorum President               a quorum presidency answers to the
 *                                            bishop: he presides over the
 *                                            Aaronic Priesthood
 *     Gatherers of Light Class President     a class presidency answers to the
 *                                            Young Women president
 *
 * Nodes are callings, not people: a clerk who is also an activity coordinator
 * appears in both places, which is what an org chart is supposed to show.
 */
import { ORGS, orgLabel, type OrgKey } from './orgs'

export type CallingRecord = {
  id: string
  org_key: string
  name: string
  unit: string | null
  is_custom: boolean
  sort: number
  /** Set when the calling is linked to a person in the ward data. */
  full_name: string | null
  /** The holder's photo, when they have one. Never set on an unlinked holder. */
  photo_url: string | null
  /**
   * The holder's name as the report printed it, for callings held by somebody
   * who has no record in the ward data yet. NULL together with full_name means
   * the calling is vacant.
   */
  printed_name: string | null
}

export type TreeNode = {
  id: string
  /** 'calling' is a real row; 'group' is a sub-heading holding several. */
  kind: 'calling' | 'group'
  /** Calling name, or the sub-heading for a group. */
  title: string
  /** Who holds it. null on a vacancy and on every group. */
  person: string | null
  /** The holder's photo URL, when the ward has one for them. */
  photoUrl: string | null
  /**
   * False when the name came off the report rather than from a person record —
   * shown, but not clickable through to a household.
   */
  linked: boolean
  org: string
  isCustom: boolean
  /** Report order, so siblings read the way LCR printed them. */
  sort: number
  children: TreeNode[]
}

/** Leaders whose title does not end in 'President'. */
const LEADER_TITLES = new Set([
  'Bishop',
  'Ward Mission Leader',
  'Ward Temple and Family History Leader',
  'Young Single Adult Leader',
])

function isLeader(name: string): boolean {
  if (LEADER_TITLES.has(name)) return true
  // 'Priests Quorum President' yes, 'Assistant Ward Mission Leader' no.
  return /(?:^|\s)President$/.test(name) && !/^Assistant/.test(name)
}

const isCounselor = (name: string) => /Counselor$/.test(name)
const isSecretary = (name: string) => /Secretary$/.test(name) && !/^Assistant|Assistant /.test(name)
const isAssistantSecretary = (name: string) => /Assistant.*Secretary$/.test(name)

/** Parent org of a child org, from the seeded tree. */
const PARENT_ORG = new Map<string, OrgKey | null>(ORGS.map((o) => [o.key, o.parent]))

function node(row: CallingRecord): TreeNode {
  return {
    id: row.id,
    kind: 'calling',
    title: row.name,
    person: row.full_name ?? row.printed_name,
    photoUrl: row.photo_url,
    linked: Boolean(row.full_name),
    org: row.org_key,
    isCustom: row.is_custom,
    sort: row.sort,
    children: [],
  }
}

/**
 * Report order, depth first. A group has no order of its own, so it takes its
 * earliest member's — which puts 'Elders Quorum Presidency' ahead of 'Teachers'
 * exactly as the report printed them.
 */
function sortTree(nodes: TreeNode[]): void {
  for (const n of nodes) {
    sortTree(n.children)
    if (n.kind === 'group' && n.children.length > 0) {
      n.sort = Math.min(...n.children.map((c) => c.sort))
    }
  }
  nodes.sort((a, b) => a.sort - b.sort)
}

/**
 * Builds the chart.
 *
 * Returns one root when the ward has a bishop, and several when it does not —
 * a half-imported database should still draw something rather than nothing.
 */
export function buildOrgTree(rows: CallingRecord[]): TreeNode[] {
  const sorted = [...rows].sort((a, b) => a.sort - b.sort)

  const bishopRow = sorted.find((r) => r.org_key === 'bishopric' && r.name === 'Bishop')
  const bishop = bishopRow ? node(bishopRow) : null

  // One leader per org — the first, so a second row for the same title (the
  // bishop is also Priests Quorum President) does not steal the slot.
  const leaders = new Map<string, TreeNode>()
  const leaderRows = new Map<string, CallingRecord>()
  for (const row of sorted) {
    if (row.id === bishopRow?.id || !isLeader(row.name)) continue
    if (leaders.has(row.org_key)) continue
    leaders.set(row.org_key, node(row))
    leaderRows.set(row.org_key, row)
  }

  /** Who an org's people hang from: its own leader, its parent's, or the bishop. */
  function anchor(orgKey: string): TreeNode | null {
    const own = leaders.get(orgKey)
    if (own) return own
    const parent = PARENT_ORG.get(orgKey)
    if (parent) {
      const up = leaders.get(parent)
      if (up) return up
    }
    return bishop
  }

  const roots: TreeNode[] = bishop ? [bishop] : []

  // Leaders first: each one hangs off the leader above it, so that a class
  // president is under the Young Women president and a quorum president is
  // under the bishop.
  for (const [orgKey, leader] of leaders) {
    const parentOrg = PARENT_ORG.get(orgKey)
    const above = (parentOrg && leaders.get(parentOrg)) || bishop
    if (above && above !== leader) above.children.push(leader)
    else roots.push(leader)
  }

  // Secretaries, so assistants have something to attach to.
  const secretaries = new Map<string, TreeNode>()
  for (const row of sorted) {
    if (row.id === bishopRow?.id || leaderRows.get(row.org_key)?.id === row.id) continue
    if (!isSecretary(row.name)) continue
    const n = node(row)
    const parent = anchor(row.org_key)
    if (parent) parent.children.push(n)
    else roots.push(n)
    if (!secretaries.has(row.org_key)) secretaries.set(row.org_key, n)
  }

  // Sub-heading groups, created on demand so an org with nobody left over gets none.
  const groups = new Map<string, TreeNode>()
  function group(orgKey: string, unit: string): TreeNode {
    const key = `${orgKey}|${unit}`
    const existing = groups.get(key)
    if (existing) return existing
    const g: TreeNode = {
      id: `group:${key}`,
      kind: 'group',
      title: unit,
      person: null,
      photoUrl: null,
      linked: false,
      org: orgKey,
      isCustom: false,
      sort: Number.MAX_SAFE_INTEGER,
      children: [],
    }
    groups.set(key, g)
    const parent = anchor(orgKey)
    if (parent) parent.children.push(g)
    else roots.push(g)
    return g
  }

  for (const row of sorted) {
    if (row.id === bishopRow?.id) continue
    if (leaderRows.get(row.org_key)?.id === row.id) continue
    if (isSecretary(row.name)) continue

    const n = node(row)

    if (isCounselor(row.name)) {
      const parent = anchor(row.org_key)
      if (parent) parent.children.push(n)
      else roots.push(n)
      continue
    }

    if (isAssistantSecretary(row.name)) {
      const parent = secretaries.get(row.org_key) ?? anchor(row.org_key)
      if (parent) parent.children.push(n)
      else roots.push(n)
      continue
    }

    // Everyone else: under the sub-heading they were printed under, or straight
    // onto the leader when the report printed no sub-heading for them.
    const parent = row.unit ? group(row.org_key, row.unit) : anchor(row.org_key)
    if (parent) parent.children.push(n)
    else roots.push(n)
  }

  // An org whose leader ended up somewhere unreachable (no bishop imported)
  // would otherwise vanish. Nothing is dropped: anything unplaced is a root.
  sortTree(roots)
  return roots
}

/** Node count including the node itself — used for the '+N' badge on a collapsed branch. */
export function countDescendants(n: TreeNode): number {
  return n.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0)
}

/** Human label for a group node's org, for the chart's subtitle line. */
export function nodeSubtitle(n: TreeNode): string {
  return n.kind === 'group' ? orgLabel(n.org) : (n.person ?? 'Vacant')
}
