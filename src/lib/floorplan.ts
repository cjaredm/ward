/**
 * Where the building drawing is, and how big it is.
 *
 * The floorplan is a static asset rather than markup: it is one ~100 KB path of
 * architectural linework that nothing in the app ever reads, hit-tests or
 * recolours, so it ships as an <image> the browser decodes once and repaints on
 * zoom without React involved. Room outlines are drawn on top of it in the same
 * user-space coordinates, which is what keeps them aligned to the walls.
 *
 * The size is the drawing's own coordinate system, not pixels and not metres.
 * Every room outline in `building_rooms.points` is in these units.
 */
export const FLOORPLAN = {
  src: '/floorplan/stake-center.svg',
  width: 2252,
  height: 1183,
} as const
