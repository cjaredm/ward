/**
 * Person photos: vetting the link, and what to draw when there isn't one.
 *
 * Photos are links to somewhere else (see migration 0012), which means two
 * things this module owns. The URL is untrusted, because it is typed in and then
 * rendered as an <img src>; and most people will never have one, so every place
 * that shows a face needs the same fallback rather than its own.
 */

/** Matches the CHECK constraint on people.photo_url. */
export const MAX_PHOTO_URL = 2000

/**
 * A photo URL fit to render, or null.
 *
 * https only and no embedded credentials. Run on the server before storing and
 * again in the browser before rendering: the second pass is what keeps a row
 * written before this existed -- or by psql -- from reaching an `src` unchecked.
 */
export function safePhotoUrl(value: string | null | undefined): string | null {
  if (!value) return null
  const raw = value.trim()
  if (!raw || raw.length > MAX_PHOTO_URL) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  // 'https://user:pass@host/x' would leak whatever was pasted with it into the
  // request and into anything that logs the URL.
  if (url.username || url.password) return null
  return url.toString()
}

/**
 * The one or two letters an avatar falls back to.
 *
 * Handles both name shapes this app holds: 'Ryan Dahle' from the member records,
 * and 'Dahle, Ryan' as the callings report prints a holder it could not match to
 * a person.
 */
export function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const comma = name.indexOf(',')
  const ordered = comma === -1 ? name : `${name.slice(comma + 1)} ${name.slice(0, comma)}`
  const words = ordered.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w))
  if (words.length === 0) return '?'
  const first = letter(words[0])
  const last = words.length > 1 ? letter(words[words.length - 1]) : ''
  return `${first}${last}` || '?'
}

/** First letter of a word, skipping punctuation like the '(' in '(unknown)'. */
function letter(word: string): string {
  return (word.match(/\p{L}/u)?.[0] ?? '').toUpperCase()
}

/**
 * A stable tint per person, so the same face keeps the same colour across the
 * chart, the list and the map panel. Hue only -- saturation and lightness are
 * fixed, so no name can draw white-on-white or fight the page.
 */
export function avatarTint(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return `hsl(${Math.abs(hash) % 360} 42% 46%)`
}
