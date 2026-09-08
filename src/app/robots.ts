import type { MetadataRoute } from 'next'

/**
 * The landing page is the only thing here meant to be found in a search result.
 *
 * Everything else is either a sign-in form or ward data — names, addresses and
 * phone numbers of members including minors — so the rule is an allow-list of
 * one path with a disallow over the whole origin behind it. Crawlers apply the
 * most specific match, so '/' stays indexable while '/members' does not.
 *
 * This is politeness, not a security control: the gate that counts is the
 * session check in middleware and in every route handler.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/$', disallow: '/' }],
  }
}
