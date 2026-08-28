/**
 * The shared shape and the URL rules for the dashboard's quick links.
 *
 * No database import here on purpose: the editor is a client component and
 * imports the type and `displayUrl` from this file. The read lives in
 * quick-links-query.ts, the same split building.ts and building-query.ts use.
 */

/** A link on the dashboard that points somewhere outside this app. */
export type QuickLink = {
  id: string
  label: string
  url: string
  sort: number
  /**
   * The accounts this link was shared with. Empty means everybody — see
   * migrations/0017_quick_link_shares.sql, decision 2.
   *
   * Only populated for an admin, who is the only person who can change it.
   * Everyone else gets an empty array whether the link is public or was shared
   * with them by name, because who else can see a link is not their business
   * and the check that matters has already happened in the query.
   */
  shared_with: string[]
}

/** Someone an admin can share a link with, as the picker needs them. */
export type ShareCandidate = {
  id: string
  name: string
  email: string
}

/**
 * What a row says about its audience, given the names the picker knows.
 *
 * Ids with no matching candidate are counted rather than dropped: an account
 * the picker filters out — a deactivated one, or an admin — is still a share
 * row, and saying "2 people" while listing one name is the honest summary.
 */
export function shareSummary(link: QuickLink, people: ShareCandidate[]): string {
  if (link.shared_with.length === 0) return 'Everyone'
  const names = link.shared_with
    .map((id) => people.find((p) => p.id === id)?.name)
    .filter((n): n is string => Boolean(n))
  const unnamed = link.shared_with.length - names.length
  if (names.length === 0) return `${link.shared_with.length} people`
  if (names.length <= 2 && unnamed === 0) return names.join(' and ')
  return `${names[0]} and ${link.shared_with.length - 1} others`
}

/**
 * The URL as it will be stored, or null if it is not one we will render.
 *
 * A bare `ward.churchofjesuschrist.org` is what somebody pastes out of the
 * address bar, and refusing it over a missing scheme would be the app being
 * pedantic about something it can fix — so a string with no scheme gets
 * `https://`. Anything that then fails to parse, or parses to a scheme other
 * than http(s), is rejected: `javascript:` in an href on a page everybody in
 * the ward loads is the one input here worth being strict about.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Scheme-relative ('//example.com') would inherit ours and parse fine, but
  // nobody pastes one, and treating it as a hostname is the friendlier read.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.hostname) return null
  return parsed.toString()
}

/** 'lcr.churchofjesuschrist.org/orgs' — what a link shows under its label. */
export function displayUrl(url: string): string {
  try {
    const { host, pathname, search } = new URL(url)
    const path = pathname === '/' ? '' : pathname
    return `${host}${path}${search}`.replace(/\/$/, '')
  } catch {
    return url
  }
}
