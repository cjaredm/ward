/**
 * Temporary passwords an admin reads out over the phone or pastes into a text.
 *
 * Four words and two digits — "harbor-maple-brisk-lantern-47" — because these
 * get dictated, retyped from a screenshot and held in someone's head for the
 * minute between receiving it and choosing their own. A random character string
 * of the same strength is unusable that way.
 *
 * Strength: 4 words from 256 (32 bits) plus 2 digits (~6.6 bits) ≈ 38 bits.
 * Against a bcrypt hash behind a 10-attempts-per-15-minutes limit, on a password
 * that is single-use and forced out at first sign-in, that is the right trade.
 */

/**
 * 256 words, so each pick is exactly one byte of randomness. All at least four
 * letters, so the shortest passphrase this can produce still clears the length
 * floor the API enforces. Every word is
 * concrete and unambiguous when spoken: nothing that sounds like another word
 * on the list, nothing anyone would mind reading aloud over the phone.
 */
export const WORDS = [
  'acorn', 'amber', 'anchor', 'apple', 'apron', 'arbor', 'arrow', 'aspen',
  'attic', 'autumn', 'bacon', 'badge', 'bagel', 'baker', 'balcony', 'bamboo',
  'banjo', 'barley', 'basil', 'basin', 'basket', 'batch', 'beach', 'beacon',
  'beaver', 'bench', 'berry', 'birch', 'bison', 'blanket', 'block', 'bloom',
  'board', 'bonfire', 'bottle', 'boulder', 'bowl', 'branch', 'brass', 'bread',
  'brick', 'bridge', 'brisk', 'bronze', 'brook', 'brush', 'bucket', 'bundle',
  'burrow', 'butter', 'button', 'cabin', 'cable', 'cactus', 'camel', 'candle',
  'canoe', 'canvas', 'canyon', 'carpet', 'carrot', 'castle', 'cedar', 'cellar',
  'chair', 'chalk', 'cherry', 'chest', 'chimney', 'cider', 'cinder', 'clay',
  'cliff', 'cloak', 'clover', 'cobalt', 'cocoa', 'coffee', 'collar', 'comet',
  'compass', 'copper', 'coral', 'cotton', 'cove', 'crane', 'crate', 'crayon',
  'creek', 'crest', 'crystal', 'curtain', 'cyclone', 'daisy', 'dawn', 'delta',
  'denim', 'desert', 'diamond', 'dolphin', 'domino', 'donut', 'draft', 'dune',
  'dusk', 'eagle', 'ember', 'engine', 'falcon', 'fern', 'ferry', 'fiddle',
  'flame', 'flannel', 'flint', 'forest', 'fossil', 'fountain', 'flute', 'frost',
  'galaxy', 'garden', 'garnet', 'gazelle', 'ginger', 'glacier', 'glove', 'granite',
  'grape', 'gravel', 'grove', 'guitar', 'hammer', 'hangar', 'harbor', 'harvest',
  'hazel', 'heron', 'hickory', 'hollow', 'honey', 'hopper', 'horizon', 'hornet',
  'ivory', 'jacket', 'jasmine', 'jetty', 'jungle', 'juniper', 'kayak', 'kettle',
  'kitten', 'ladder', 'lagoon', 'lantern', 'lark', 'lattice', 'lava', 'ledger',
  'lemon', 'lentil', 'lilac', 'linen', 'lobby', 'locket', 'lodge', 'lotus',
  'lumber', 'lunar', 'magnet', 'mango', 'maple', 'marble', 'marina', 'meadow',
  'melon', 'meteor', 'mitten', 'monarch', 'mosaic', 'moss', 'mountain', 'muffin',
  'mulberry', 'mustard', 'nectar', 'nickel', 'noble', 'north', 'nutmeg', 'oasis',
  'ocean', 'olive', 'onyx', 'opal', 'orbit', 'orchard', 'orchid', 'otter',
  'oxygen', 'paddle', 'palace', 'pantry', 'papaya', 'parcel', 'parsley', 'pasture',
  'peach', 'pebble', 'pelican', 'pepper', 'pewter', 'pigeon', 'pillow', 'pilot',
  'pine', 'pistachio', 'pivot', 'plateau', 'plaza', 'plum', 'pocket', 'pollen',
  'pond', 'poplar', 'porch', 'potato', 'prairie', 'pretzel', 'prism', 'pudding',
  'pumpkin', 'quarry', 'quartz', 'quilt', 'rabbit', 'radish', 'rafter', 'ranch',
  'rapids', 'raven', 'ribbon', 'ridge', 'river', 'robin', 'rocket', 'rooster',
  'rosemary', 'rudder', 'saddle', 'saffron', 'sage', 'salmon', 'sandal', 'sapphire',
] as const

/**
 * The randomness source, so the browser can pass crypto.getRandomValues and a
 * terminal script can pass node:crypto randomInt. `bound` is exclusive.
 */
export type RandomInt = (bound: number) => number

export const TEMP_WORD_COUNT = 4

/** e.g. "harbor-maple-brisk-lantern-47" */
export function generateTempPassword(randomInt: RandomInt): string {
  const words = Array.from({ length: TEMP_WORD_COUNT }, () => WORDS[randomInt(WORDS.length)])
  const digits = String(randomInt(100)).padStart(2, '0')
  return [...words, digits].join('-')
}
