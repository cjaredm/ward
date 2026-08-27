/**
 * Exercises the room-label fit ladder. No database, no browser.
 *
 *   npx tsx scripts/test-building-labels.ts
 */
import {
  LABEL_PX,
  abbreviate,
  fitRoomLabel,
  textWidth,
  wrapToBox,
} from '../src/lib/building-labels'
import { bbox } from '../src/lib/floorplan-geom'
import { run } from './lib/run'

/** Room 101 from the drawing: a small classroom, ~140 x 120 floorplan units. */
const ROOM_101 = bbox([
  [192, 281],
  [332, 281],
  [332, 403],
  [192, 403],
])

/**
 * Room 118, and its neighbour. 118 is 84 units wide and the Bishop's Office rooms
 * beside it are 100-102, which is the whole bug: renaming 118 to "Bishop's Office"
 * lost its label while three identically named rooms two units wider kept theirs.
 */
const ROOM_118 = bbox([
  [508, 946],
  [592, 946],
  [592, 1054],
  [508, 1054],
])

const BISHOPS_OFFICE_1 = bbox([
  [192, 944],
  [294, 944],
  [294, 1054],
  [192, 1054],
])

/** Cultural Center One: ~360 x 425 units. */
const CULTURAL_HALL = bbox([
  [850, 379],
  [1210, 379],
  [1210, 804],
  [850, 804],
])

/** The room's box in screen pixels at a given scale. */
const onScreen = (box: { w: number; h: number }, k: number) => ({ w: box.w * k, h: box.h * k })

run(async () => {
  const failures: string[] = []
  const check = (cond: boolean, why: string) => {
    if (!cond) failures.push(why)
  }

  // --- the ladder, at the zooms that actually happen -----------------------
  // A phone fits 2252 units into ~390px, so k is about 0.17 and room 101 is 24px
  // across. Nothing fits, and nothing is drawn: the room still has its <title>
  // and its panel.
  const phoneFit = 390 / 2252
  check(
    fitRoomLabel('Course 15', '101', onScreen(ROOM_101, phoneFit)) === null,
    'room 101 at phone fit zoom is too small for any text at all',
  )

  // A laptop fits it into ~1100px, so k is about 0.5 and room 101 is 70x61 —
  // room for a short title stacked on two lines, but not a long one.
  const laptopFit = 1100 / 2252
  const shortAtFit = fitRoomLabel('Course 15', '101', onScreen(ROOM_101, laptopFit))
  check(
    shortAtFit?.lines.join(' ') === 'Course 15',
    `room 101 at laptop fit should fit a short class name, got ${JSON.stringify(shortAtFit)}`,
  )

  // A long name now wraps and overhangs rather than jumping straight to initials:
  // three readable lines beat 'P10'. The abbreviation is still there as the step
  // below, for when even the wrap will not go.
  const longAtFit = fitRoomLabel(
    'Primary Activities Boys 9 and 10',
    '101',
    onScreen(ROOM_101, laptopFit),
  )
  check(longAtFit?.mode === 'inside', 'a long class name should still label on the room')
  check(
    longAtFit !== null && longAtFit.lines.length > 1,
    `a long class name should wrap rather than abbreviate here, got ${JSON.stringify(longAtFit)}`,
  )
  const tightBox = onScreen(ROOM_101, 0.34)
  const abbreviated = fitRoomLabel('Primary Activities Boys 9 and 10', '101', tightBox)
  check(
    abbreviated === null || abbreviated.lines.join(' ').length < 14,
    `squeezed harder it should shorten, got ${JSON.stringify(abbreviated)}`,
  )

  const unassigned = fitRoomLabel(null, '101', onScreen(ROOM_101, laptopFit))
  check(
    unassigned?.lines.join(' ') === '101',
    `an unassigned room should show its own number, got ${JSON.stringify(unassigned)}`,
  )

  const hallAtFit = fitRoomLabel(
    'Relief Society',
    'Cultural Center One',
    onScreen(CULTURAL_HALL, laptopFit),
  )
  check(
    hallAtFit?.lines.join(' ') === 'Relief Society',
    `the hall at fit zoom should show the full title, got ${JSON.stringify(hallAtFit)}`,
  )

  // --- the ladder zoomed in -------------------------------------------------
  const smallAtThree = fitRoomLabel('Course 15', '101', onScreen(ROOM_101, 3))
  check(
    smallAtThree?.lines.join(' ') === 'Course 15',
    `room 101 at 3x should show its class, got ${JSON.stringify(smallAtThree)}`,
  )

  // --- nothing at all -------------------------------------------------------
  check(
    fitRoomLabel('Course 15', 'Closet', { w: 8, h: 6 }) === null,
    'a room too small for any text should get no label rather than an overflowing one',
  )
  check(
    fitRoomLabel(null, '101', { w: 6, h: 40 }) === null,
    'a sliver narrower than one glyph should get no label',
  )

  // --- overflow stays within its allowance ---------------------------------
  // A label may spill past its walls, but only by the documented allowance: 16px
  // each side, and never more than a quarter of the room again.
  for (const k of [0.3, 0.5, 1, 2, 4]) {
    for (const [box, name] of [
      [ROOM_101, '101'],
      [ROOM_118, "Bishop's Office"],
      [CULTURAL_HALL, 'Cultural Center One'],
    ] as const) {
      const screen = onScreen(box, k)
      const fitted = fitRoomLabel('Primary Activities Boys 9 and 10', name, screen)
      if (!fitted || fitted.mode !== 'inside') continue
      const widest = Math.max(...fitted.lines.map((l) => textWidth(l, fitted.px)))
      const allowed = screen.w + 2 * Math.min(16, screen.w * 0.25)
      check(
        widest <= allowed,
        `at k=${k} the label for ${name} is ${widest.toFixed(0)}px in a ${screen.w.toFixed(
          0,
        )}px room, past the ${allowed.toFixed(0)}px allowance`,
      )
    }
  }

  // --- wrapToBox ------------------------------------------------------------
  const wrapped = wrapToBox('Relief Society', { w: 90, h: 60 }, LABEL_PX)
  check(wrapped?.lines.length === 2, `'Relief Society' should wrap onto two lines in a 90px box, got ${JSON.stringify(wrapped)}`)
  check(
    wrapToBox('Relief Society', { w: 90, h: 18 }, LABEL_PX) === null,
    'a box with room for one line should reject a two-line wrap',
  )
  check(
    wrapToBox('Reverence', { w: 30, h: 200 }, LABEL_PX) === null,
    'a single word wider than the box must not be hyphenated onto two lines',
  )

  // --- abbreviate -----------------------------------------------------------
  check(abbreviate('Relief Society') === 'RS', `'Relief Society' -> RS, got ${abbreviate('Relief Society')}`)
  check(abbreviate('Course 15') === 'C15', `'Course 15' -> C15, got ${abbreviate('Course 15')}`)
  check(abbreviate('Valiant 9') === 'V9', `'Valiant 9' -> V9, got ${abbreviate('Valiant 9')}`)
  check(abbreviate('Nursery') === 'Nurs.', `'Nursery' -> Nurs., got ${abbreviate('Nursery')}`)
  check(abbreviate('101') === '101', 'a room number is already short enough to keep whole')
  check(abbreviate('') === '', 'an empty title abbreviates to nothing')

  // --- room 118: the regression this ladder was rewritten for ---------------
  // No class scheduled, so the label is the room's own name. At the zoom the bug
  // was reported at, "Bishop's" alone is wider than the room.
  const reported = 0.62
  const b118 = fitRoomLabel(null, "Bishop's Office", onScreen(ROOM_118, reported))
  check(b118 !== null, 'room 118 must get a label, not nothing (this was the bug)')
  check(
    b118?.mode === 'inside',
    `room 118 should still label inside its own walls, got ${b118?.mode}`,
  )
  const b1 = fitRoomLabel(null, "Bishop's Office", onScreen(BISHOPS_OFFICE_1, reported))
  check(
    b118?.lines.join(' ') === b1?.lines.join(' '),
    `two rooms of the same name 18 units apart should read the same, got ${JSON.stringify(
      b118?.lines,
    )} vs ${JSON.stringify(b1?.lines)}`,
  )

  // --- overflow is bounded --------------------------------------------------
  for (const k of [0.3, 0.62, 1, 2]) {
    const screen = onScreen(ROOM_118, k)
    const fitted = fitRoomLabel(null, "Bishop's Office", screen)
    if (!fitted || fitted.mode !== 'inside') continue
    const widest = Math.max(...fitted.lines.map((l) => textWidth(l, fitted.px)))
    // A little past the walls is the point; a lot would cross the room beyond.
    check(
      widest <= screen.w + 40,
      `at k=${k} room 118's label overflows by ${(widest - screen.w).toFixed(0)}px, which is too much`,
    )
  }

  // --- force / callout ------------------------------------------------------
  const tiny = { w: 10, h: 8 }
  check(
    fitRoomLabel('Course 15', 'Closet', tiny) === null,
    'an unforced label in a room too small for anything should still render nothing',
  )
  const forced = fitRoomLabel('Course 15', 'Closet', tiny, true)
  check(forced?.mode === 'callout', `a forced label should fall back to a callout, got ${forced?.mode}`)
  check(
    forced?.lines.join(' ') === 'Course 15',
    'a callout should carry the class name, unwrapped',
  )
  check(
    fitRoomLabel(null, '118', tiny, true)?.lines.join(' ') === '118',
    'a forced label with no class should call out the room name',
  )
  check(
    fitRoomLabel('Course 15', '101', onScreen(ROOM_101, 3), true)?.mode === 'inside',
    'forcing must not turn a label that fits into a callout',
  )

  console.log()
  if (failures.length > 0) {
    for (const f of failures) console.log(`FAIL  ${f}`)
    process.exitCode = 1
    return
  }
  console.log('ok — building labels')
})
