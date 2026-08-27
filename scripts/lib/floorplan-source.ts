/**
 * Reads the starter drawing and splits it into the two things the app needs: a
 * static wall asset, and one row per room.
 *
 * The drawing arrives as a self-contained HTML viewer — one <svg> holding a
 * <g id="rooms"> of tagged polygons and a <g id="walls"> of architectural
 * linework. Nothing about that file ships; it is a source, which is why it lives
 * in data/ alongside directory.tsv and overture-places.json.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeRing, parsePathD, type Pt } from '../../src/lib/floorplan-geom'
import { slugifyRoomKey } from '../../src/lib/building'
import { FLOORPLAN } from '../../src/lib/floorplan'

/**
 * Where the drawing is looked for, in order.
 *
 * Two names because the file arrives as an exported viewer called
 * floorplan-viewer.html and there is no reason to make somebody rename it before
 * the seed will run.
 */
export const SOURCE_NAMES = ['floorplan-viewer.html', 'floorplan.html'] as const

export function sourceCandidates(): string[] {
  return SOURCE_NAMES.map((name) => join(process.cwd(), 'data', name))
}

export type SourceRoom = {
  key: string
  name: string
  points: Pt[]
  is_assignable: boolean
  sort: number
}

/**
 * Rooms nothing is ever scheduled in.
 *
 * They are on the drawing because the drawing is the building, but a class does
 * not meet in a kitchen or on the platform, and left assignable they would sit
 * in "rooms free this hour" every week. A starting guess, not a rule — the flag
 * is editable per room in the UI.
 */
const NOT_ASSIGNABLE = new Set([
  'platform',
  'serving-area',
  'materials-center',
  'member-custodial',
  'mothers-room',
])

/** Pulls one attribute off a tag, single or double quoted. */
function attr(tag: string, name: string): string | null {
  const m =
    tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`)) ??
    tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`))
  return m ? m[1] : null
}

/** Unescapes the handful of entities an SVG attribute can carry. */
function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** The contents of `<g id="NAME"> … </g>`, non-greedy to the first closing tag. */
function group(html: string, id: string): string {
  const open = html.match(new RegExp(`<g\\s+id=["']${id}["'][^>]*>`))
  if (!open || open.index === undefined) {
    throw new Error(`The drawing has no <g id="${id}"> group.`)
  }
  const from = open.index + open[0].length
  const close = html.indexOf('</g>', from)
  if (close === -1) throw new Error(`<g id="${id}"> is never closed.`)
  return html.slice(from, close)
}

export async function readSource(): Promise<{ path: string; html: string }> {
  for (const path of sourceCandidates()) {
    try {
      return { path, html: await readFile(path, 'utf8') }
    } catch {
      // Try the next name before giving up.
    }
  }
  throw new Error(
    `Cannot find the floorplan drawing. Looked for:\n` +
      sourceCandidates()
        .map((p) => `  ${p}`)
        .join('\n') +
      '\n\nSave the stake centre floorplan viewer to one of those — it is the source\n' +
      'the wall asset and the room outlines are both derived from.',
  )
}

/**
 * The rooms, in the order the drawing lists them.
 *
 * Keys come from the SVG ids ('room-high-council' -> 'high-council') so the seed
 * is re-runnable against known keys, falling back to a slug of the name for a
 * room traced in the viewer after the fact.
 */
export function parseRooms(html: string): SourceRoom[] {
  const rooms: SourceRoom[] = []
  const taken = new Set<string>()

  for (const [, tag] of group(html, 'rooms').matchAll(/(<path\b[^>]*>)/g)) {
    const d = attr(tag, 'd')
    if (!d || !d.trim()) continue

    const id = attr(tag, 'id') ?? ''
    const name = unescapeXml(attr(tag, 'data-name') ?? id.replace(/^room-/, '')).trim()
    const fromId = id.replace(/^room-/, '').trim()
    const key = fromId && !taken.has(fromId) ? fromId : slugifyRoomKey(name || 'room', taken)
    taken.add(key)

    let points: Pt[]
    try {
      points = normalizeRing(parsePathD(d))
    } catch (err) {
      throw new Error(
        `Room '${key}' has an outline this app cannot store: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
    if (points.length < 3) throw new Error(`Room '${key}' has fewer than three corners.`)

    rooms.push({
      key,
      name: name || key,
      points,
      is_assignable: !NOT_ASSIGNABLE.has(key),
      sort: rooms.length * 10,
    })
  }

  if (rooms.length === 0) throw new Error('The drawing contains no room outlines.')
  return rooms
}

/**
 * The wall asset: the background and the linework, and nothing else.
 *
 * Written as its own file rather than inlined into the page because it is ~100 KB
 * that nothing reads, hit-tests or recolours — see src/lib/floorplan.ts. The
 * viewBox is restated here so the asset stands alone at the same scale the room
 * outlines are in.
 */
export function buildWallSvg(html: string, sourceName: string): string {
  const walls = group(html, 'walls').trim()
  if (!walls.includes('<path')) throw new Error('The walls group contains no linework.')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FLOORPLAN.width} ${FLOORPLAN.height}" width="${FLOORPLAN.width}" height="${FLOORPLAN.height}">`,
    `  <!-- Generated by scripts/seed-building.ts from data/${sourceName}. Do not edit. -->`,
    '  <style>',
    '    #walls { fill: none; stroke: #111; stroke-width: .7; stroke-linecap: round; stroke-linejoin: round }',
    '  </style>',
    `  <rect x="0" y="0" width="${FLOORPLAN.width}" height="${FLOORPLAN.height}" fill="#fff"/>`,
    `  <g id="walls">${walls}</g>`,
    '</svg>',
    '',
  ].join('\n')
}
