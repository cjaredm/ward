/**
 * Deciding what text, if any, fits inside a room.
 *
 * Labels are drawn at a constant *screen* size — `fontSize={LABEL_PX / view.k}` —
 * so 12px of text stays 12px of text at every zoom. The alternative, scaling the
 * font to the room, makes the cultural hall's label 80px tall while room 101's is
 * three pixels, and the set reads as noise rather than as a map.
 *
 * That turns the question into "does this text fit inside this room's *on-screen*
 * box", which is what everything here answers. Widths are estimated from an
 * average glyph width rather than measured: measuring means a canvas context or a
 * DOM round trip per room per zoom step, and the estimate only has to be good
 * enough to choose between a full title, an abbreviation, and nothing.
 */

/** Rendered label size in screen pixels, whatever the zoom. */
export const LABEL_PX = 12
/** The room's own name, under the class title, one step smaller. */
export const SUBLABEL_PX = 10

/** Average glyph width as a fraction of font size, for the UI's sans stack. */
const GLYPH = 0.55
/** Line box height as a fraction of font size. */
const LINE = 1.2
/** Text is never drawn hard against a wall. Screen pixels, each side. */
const INSET = 4

/**
 * How far a label may spill past its own walls, in screen pixels each side.
 *
 * Rooms in this building are drawn to fit desks, not names: room 118 is 84 units
 * wide and "Bishop's" needs 53px of them, so a label confined to the outline
 * disappears in a room whose neighbours — two units wider — keep theirs. A little
 * overflow reads fine on a floorplan, because the wall it crosses is a thin line
 * and the fill underneath is the room's own tint.
 */
const OVERFLOW = 16

/**
 * Overflow is also capped to a quarter of the room, whichever is smaller.
 *
 * A flat 16px each side is a little on the cultural hall and a third again on a
 * 24px closet, where the label would end up wider than the thing it names.
 */
const OVERFLOW_SHARE = 0.25

/**
 * Below this, in screen pixels either dimension, a room gets no label at all.
 *
 * At a whole-building zoom on a phone every classroom is about 24px across.
 * Abbreviating hard enough to fit is possible and useless: thirty three-letter
 * stubs is not a map anybody reads. Nothing is the right answer, and the room
 * still has its <title> and one tap to the panel.
 */
const MIN_BOX = 30

export function textWidth(text: string, px: number): number {
  return text.length * px * GLYPH
}

export type FittedLabel = {
  lines: string[]
  px: number
  /**
   * 'inside' sits on the room, spilling a little past its walls at most.
   * 'callout' did not fit at all and is drawn clear of the room with a leader
   * line pointing back at it.
   */
  mode: 'inside' | 'callout'
}

/**
 * Wraps on spaces, or reports that it cannot.
 *
 * Returns null rather than an overflowing line: a label that spills across a wall
 * into the next room is actively misleading, and every room already carries a
 * <title> and a panel for the text that did not fit.
 */
export function wrapToBox(
  text: string,
  box: { w: number; h: number },
  px: number,
  slack = 0,
): FittedLabel | null {
  const usableW = box.w - INSET * 2 + slack * 2
  const usableH = box.h - INSET * 2
  if (usableW <= 0 || usableH <= 0) return null

  const maxLines = Math.max(1, Math.floor(usableH / (px * LINE)))
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null

  const lines: string[] = []
  let line = ''
  for (const word of words) {
    // A single word wider than the box can never be broken onto two lines
    // without hyphenating, which at 12px reads worse than no label at all.
    if (textWidth(word, px) > usableW) return null
    const candidate = line ? `${line} ${word}` : word
    if (textWidth(candidate, px) <= usableW) {
      line = candidate
    } else {
      lines.push(line)
      line = word
      if (lines.length > maxLines) return null
    }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) return null
  return { lines, px, mode: 'inside' }
}

/**
 * 'Relief Society' -> 'RS', 'Course 15' -> 'C15', 'Nursery' -> 'Nurs.'
 *
 * The step between "the whole title" and "nothing at all". Initials for anything
 * multi-word, because that is how these are said out loud anyway — RS, YM, YW.
 */
export function abbreviate(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (words.length === 1) {
    const word = words[0]
    return word.length <= 5 ? word : `${word.slice(0, 4)}.`
  }
  // 'Course 15' and 'Valiant 9': a trailing number is the part that identifies
  // the class, so it survives whole rather than becoming 'C1'.
  const last = words[words.length - 1]
  if (/^\d+$/.test(last)) {
    return `${words[0][0].toUpperCase()}${last}`
  }
  return words
    .map((w) => w[0].toUpperCase())
    .join('')
    .slice(0, 4)
}

/**
 * The ladder every room label walks down.
 *
 * Full title on the room; then the title allowed to spill a little past the
 * walls; then an abbreviation; then the room's own name the same way; and only
 * when none of that fits, a callout drawn clear of the room with a line pointing
 * back at it.
 *
 * `box` is the room's bounding box **in screen pixels** — its bbox in floorplan
 * units times the current scale. `title` is null for a room with nothing
 * scheduled, which then only ever shows its own name.
 *
 * `force` keeps a label for something that must not disappear: the room somebody
 * has open, and any room with a class in it. Without it a scheduled class can go
 * unlabelled, which is the one thing this page exists to show. Everything else
 * gets to render nothing rather than litter a zoomed-out plan with callouts.
 */
export function fitRoomLabel(
  title: string | null,
  roomName: string,
  box: { w: number; h: number },
  force = false,
): FittedLabel | null {
  // Too small for any of this to be worth reading.
  if (box.w < MIN_BOX || box.h < MIN_BOX) {
    return force ? { lines: [title ?? roomName], px: LABEL_PX, mode: 'callout' } : null
  }

  const short = title ? abbreviate(title) : ''
  const shortName = abbreviate(roomName)

  const attempts: (string | null)[] = [
    // Inside the walls proper.
    title,
    // Then the same text, allowed to overhang.
    title,
    // Then shortened, if shortening it actually changes anything.
    short && short !== title ? short : null,
    // Then the room's own name — on a zoomed-out plan "118" is what somebody is
    // looking for anyway, so this is not a consolation prize.
    roomName,
    shortName && shortName !== roomName ? shortName : null,
  ]
  // A little past the walls, never more than a quarter of the room again.
  const slack = Math.min(OVERFLOW, box.w * OVERFLOW_SHARE)
  const slacks = [0, slack, slack, slack, slack]
  // The room's own name is set one step down from a class name, so a label that
  // is a room number does not read as loudly as one that is a class.
  const sizes = [LABEL_PX, LABEL_PX, LABEL_PX, title ? SUBLABEL_PX : LABEL_PX, title ? SUBLABEL_PX : LABEL_PX]

  for (let i = 0; i < attempts.length; i++) {
    const text = attempts[i]
    if (!text) continue
    const fitted = wrapToBox(text, box, sizes[i], slacks[i])
    if (fitted) return fitted
  }

  if (!force) return null

  // Nothing fits. One line, unwrapped, drawn beside the room — the canvas runs a
  // leader line from the room back to it.
  return { lines: [title ?? roomName], px: LABEL_PX, mode: 'callout' }
}
