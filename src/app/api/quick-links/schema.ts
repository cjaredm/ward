/**
 * The shapes both quick-link writes are validated against, so adding a link and
 * editing one cannot disagree about what a label or an audience may be.
 */
import { z } from 'zod'

export const Label = z.string().trim().min(1).max(80)

/** Validated properly by `normalizeUrl`; this only bounds the string. */
export const RawUrl = z.string().trim().min(1).max(2000)

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The accounts a link is shared with. Empty means everybody.
 *
 * The shape is checked here rather than left to the `::uuid` cast so a
 * malformed id comes back as a sentence instead of a Postgres error, and
 * duplicates are collapsed so the primary key never has to refuse one. The
 * ceiling is well past every account a ward will ever have; it is here so a
 * hand-written request cannot ask for a million-row insert.
 */
export const SharedWith = z
  .array(z.string().regex(UUID, 'Not an account id'))
  .max(500)
  .transform((ids) => [...new Set(ids)])
