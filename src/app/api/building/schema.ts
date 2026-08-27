/**
 * The shapes every building-map write is validated against, in one place so a
 * room traced by the canvas and a room posted by hand cannot disagree.
 */
import { z } from 'zod'
import { FLOORPLAN } from '@/lib/floorplan'

/**
 * One corner, in floorplan units.
 *
 * The tolerance past the drawing's edge is deliberate: tracing an exterior wall
 * overshoots by a unit or two, and hard-clamping to 0..2252 would reject a
 * legitimate outline of the outside of the building.
 */
const SLOP = 64
export const Point = z.tuple([
  z.number().gte(-SLOP).lte(FLOORPLAN.width + SLOP),
  z.number().gte(-SLOP).lte(FLOORPLAN.height + SLOP),
])

/** Three corners minimum, and a ceiling well past the busiest real room. */
export const Ring = z.array(Point).min(3).max(400)

/** 'HH:MM', 24-hour, which is what <input type="time"> submits. */
export const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour HH:MM time')

export const RoomName = z.string().trim().min(1).max(80)
export const AssignmentTitle = z.string().trim().min(1).max(80)
export const Notes = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v ? v : null))

/** An org key, or explicitly nothing. Existence is checked against `orgs`. */
export const OrgKey = z
  .string()
  .trim()
  .max(60)
  .nullish()
  .transform((v) => (v ? v : null))

export const Unit = z
  .string()
  .trim()
  .max(120)
  .nullish()
  .transform((v) => v ?? '')
