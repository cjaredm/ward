/**
 * Putting an address on the map.
 *
 * Both importers face the same question — the ward directory script and the
 * member-list upload — and it has the same three answers:
 *
 *   the county has a parcel at that address    attach the household to it
 *   the county has the street but not the      drop a pin interpolated between
 *   number                                     its numbered neighbours
 *   nothing matches, or no address at all      park a pin at the centre of the
 *                                              ward to be dragged onto its house
 *
 * A pin on the right block is worth far more than one in the middle of the ward:
 * the user still drags it the last few metres, but they can see which house it
 * belongs to.
 */
import { coreKey, editDistance, fullKey, parseAddress, type Address } from '../address'

export type ParcelRow = {
  parcel_id: string
  address: string | null
  use_type: string
  lng: number
  lat: number
}

/** How far apart parked pins sit, in metres. Enough that labels do not collide. */
export const PIN_SPACING_M = 30

export type ParcelIndex = {
  byFull: Map<string, ParcelRow[]>
  byCore: Map<string, ParcelRow[]>
  all: { parcel: ParcelRow; addr: Address }[]
}

/** Index of county parcels by both address keys. */
export function indexParcels(parcels: ParcelRow[]): ParcelIndex {
  const byFull = new Map<string, ParcelRow[]>()
  const byCore = new Map<string, ParcelRow[]>()
  const all: { parcel: ParcelRow; addr: Address }[] = []

  for (const p of parcels) {
    if (!p.address) continue
    const addr = parseAddress(p.address)
    if (!addr) continue
    all.push({ parcel: p, addr })
    for (const [map, key] of [
      [byFull, fullKey(addr)],
      [byCore, coreKey(addr)],
    ] as const) {
      const list = map.get(key)
      if (list) list.push(p)
      else map.set(key, [p])
    }
  }

  return { byFull, byCore, all }
}

/**
 * Narrows several candidates for one address down to one.
 *
 * A tie is only ever broken toward a home: a family living at an address that
 * also matches a shed or a common-area sliver belongs in the house. Anything
 * still ambiguous is reported rather than guessed at.
 */
function pick(candidates: ParcelRow[]): ParcelRow | null {
  if (candidates.length === 1) return candidates[0]
  const homes = candidates.filter((c) => c.use_type === 'residence')
  return homes.length === 1 ? homes[0] : null
}

export function matchParcel(
  address: Address,
  idx: ParcelIndex,
): { parcel: ParcelRow; how: string } | { parcel: null; how: string } {
  const exact = pick(idx.byFull.get(fullKey(address)) ?? [])
  if (exact) return { parcel: exact, how: 'exact' }

  const core = pick(idx.byCore.get(coreKey(address)) ?? [])
  if (core) return { parcel: core, how: 'number+street' }

  // Typo tolerance, and only within the same house number: 'SUNSCREST' for
  // 'SUNCREST'. Two houses on the same number and near-identical streets do not
  // exist here, but if they ever do, `pick` refuses to choose.
  const near = idx.all.filter(
    (c) => c.addr.num === address.num && editDistance(c.addr.core, address.core, 2) <= 2,
  )
  const fuzzy = pick(near.map((c) => c.parcel))
  if (fuzzy) return { parcel: fuzzy, how: `fuzzy → ${fuzzy.address}` }

  const seen = (idx.byCore.get(coreKey(address)) ?? []).length + near.length
  return { parcel: null, how: seen > 1 ? 'ambiguous' : 'no parcel' }
}

/**
 * Guesses a point for an address the county has no parcel for, by interpolating
 * between its numbered neighbours on the same street.
 *
 * 1456 E Mesa View Ln has no parcel, but 1445 and 1466 do, and the house is
 * physically between them.
 *
 * Returns null when the street is unknown to us, or a single neighbour makes the
 * guess meaningless.
 */
export function interpolateOnStreet(
  address: Address,
  idx: ParcelIndex,
): { lng: number; lat: number; near: string } | null {
  const want = Number(address.num.replace(/\D/g, ''))
  const onStreet = idx.all
    .filter((c) => c.addr.core === address.core)
    .map((c) => ({ n: Number(c.addr.num.replace(/\D/g, '')), p: c.parcel }))
    .filter((c) => Number.isFinite(c.n))

  // Odd and even sides of a street are opposite sides of the road, so mixing
  // them puts the pin across the street from the house.
  const sameSide = onStreet.filter((c) => c.n % 2 === want % 2)
  const pool = sameSide.length >= 2 ? sameSide : onStreet
  if (pool.length < 2) return null

  const sorted = pool.sort((a, b) => Math.abs(a.n - want) - Math.abs(b.n - want)).slice(0, 2)
  const [a, b] = sorted
  if (a.n === b.n) return null

  // Clamped so an address off the end of the street lands at the end of it
  // rather than somewhere in the desert.
  const t = Math.max(0, Math.min(1, (want - a.n) / (b.n - a.n)))
  return {
    lng: a.p.lng + (b.p.lng - a.p.lng) * t,
    lat: a.p.lat + (b.p.lat - a.p.lat) * t,
    near: `${a.p.address} / ${b.p.address}`,
  }
}

/** Metres to degrees at a given latitude. */
export function offset(lng: number, lat: number, dxM: number, dyM: number): [number, number] {
  const dLat = dyM / 111320
  const dLng = dxM / (111320 * Math.cos((lat * Math.PI) / 180))
  return [lng + dLng, lat + dLat]
}

/**
 * Parking spots for households we cannot place: a sunflower spiral around the
 * middle of the ward. They land in a tidy, obviously-artificial cluster the user
 * drags onto the right houses, rather than scattered over real parcels.
 */
export function parkingSpot(centre: [number, number], i: number): [number, number] {
  const r = PIN_SPACING_M * Math.sqrt(i + 1)
  const theta = i * 2.399963229728653 // golden angle
  return offset(centre[0], centre[1], r * Math.cos(theta), r * Math.sin(theta))
}

/** Where one address lands, with a line of explanation for the preview. */
export type Placement =
  | { kind: 'parcel'; parcelId: string; how: string }
  | { kind: 'pin'; lng: number; lat: number; why: string }

export function place(
  raw: string | null,
  idx: ParcelIndex,
  park: () => [number, number],
): Placement {
  const address = raw ? parseAddress(raw) : null
  if (!address) {
    const [lng, lat] = park()
    return { kind: 'pin', lng, lat, why: raw ? 'address could not be read' : 'no address on file' }
  }

  const m = matchParcel(address, idx)
  // A business parcel holds tenants, not households, so a family whose address
  // lands on one is pinned exactly where it is rather than attached.
  if (m.parcel && m.parcel.use_type !== 'business') {
    return { kind: 'parcel', parcelId: m.parcel.parcel_id, how: m.how }
  }
  if (m.parcel) {
    return {
      kind: 'pin',
      lng: m.parcel.lng,
      lat: m.parcel.lat,
      why: `${m.parcel.parcel_id} is marked business`,
    }
  }

  const guess = interpolateOnStreet(address, idx)
  if (guess) {
    return {
      kind: 'pin',
      lng: guess.lng,
      lat: guess.lat,
      why: `${m.how} — placed between ${guess.near}`,
    }
  }

  const [lng, lat] = park()
  return { kind: 'pin', lng, lat, why: `${m.how} — parked at ward centre` }
}
