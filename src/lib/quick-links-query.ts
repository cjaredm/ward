import { sql } from './db'
import type { QuickLink, ShareCandidate } from './quick-links'

type Viewer = { id: string; is_admin: boolean }

/**
 * The links this person may see, in display order.
 *
 * Read on the server as part of rendering the dashboard rather than fetched by
 * the client after paint: the list is a handful of rows, and having it in the
 * first HTML means the links are clickable the moment the page appears instead
 * of arriving a beat later and shifting what is under the thumb.
 *
 * Two queries rather than one, because they answer different questions. An
 * admin is shown every link *and* its audience, which they are about to edit.
 * Everybody else is shown the links that are public or theirs, and never the
 * share list — the filter is the whole of what they need, and shipping the
 * audience of a link to the browser of somebody who cannot change it hands out
 * a fact about other people for nothing.
 *
 * This is the gate on private links, and it is a WHERE clause rather than a
 * filter after the read on purpose: a link somebody may not see never leaves
 * the database.
 */
export async function listQuickLinks(viewer: Viewer): Promise<QuickLink[]> {
  if (viewer.is_admin) {
    return (await sql`
      SELECT l.id::text, l.label, l.url, l.sort,
             coalesce(
               array_agg(s.user_id::text ORDER BY s.created_at)
                 FILTER (WHERE s.user_id IS NOT NULL),
               '{}'
             ) AS shared_with
      FROM quick_links l
      LEFT JOIN quick_link_shares s ON s.link_id = l.id
      GROUP BY l.id, l.label, l.url, l.sort, l.created_at
      ORDER BY l.sort, l.created_at
    `) as QuickLink[]
  }

  const rows = (await sql`
    SELECT l.id::text, l.label, l.url, l.sort
    FROM quick_links l
    WHERE NOT EXISTS (SELECT 1 FROM quick_link_shares s WHERE s.link_id = l.id)
       OR EXISTS (
            SELECT 1 FROM quick_link_shares s
            WHERE s.link_id = l.id AND s.user_id = ${viewer.id}::uuid
          )
    ORDER BY l.sort, l.created_at
  `) as Omit<QuickLink, 'shared_with'>[]

  return rows.map((r) => ({ ...r, shared_with: [] }))
}

/**
 * The accounts an admin can share a link with.
 *
 * Admins are left out because they already see every link, so offering one as a
 * choice would be a tick box that changes nothing. Deactivated accounts are
 * left out too — they cannot sign in, and a list of everybody who ever had an
 * account makes the common case harder to read. Shares belonging to either are
 * still stored and still counted; see `shareSummary`.
 */
export async function listShareCandidates(): Promise<ShareCandidate[]> {
  return (await sql`
    SELECT id::text, name, email
    FROM users
    WHERE is_active AND NOT is_admin
    ORDER BY lower(name)
  `) as ShareCandidate[]
}

/**
 * Replaces a link's audience with exactly these accounts.
 *
 * Delete-then-insert rather than a diff: the set is a handful of rows, the
 * editor always sends the whole audience, and a diff would be more code for the
 * same result. Both statements go in one `sql.transaction`, so a failure
 * halfway cannot leave a link readable by nobody.
 *
 * Unknown ids are rejected by the caller before this runs — the foreign key
 * would catch them too, but as a 500 rather than a sentence.
 */
export async function setShares(linkId: string, userIds: string[]): Promise<void> {
  const statements = [sql`DELETE FROM quick_link_shares WHERE link_id = ${linkId}::uuid`]
  if (userIds.length > 0) {
    statements.push(sql`
      INSERT INTO quick_link_shares (link_id, user_id)
      SELECT ${linkId}::uuid, u FROM unnest(${userIds}::uuid[]) AS u
    `)
  }
  await sql.transaction(statements)
}

/** The ids in this list that are not accounts, for the 400 that says so. */
export async function unknownUserIds(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return []
  const rows = (await sql`
    SELECT id::text FROM users WHERE id = ANY(${userIds}::uuid[])
  `) as { id: string }[]
  const known = new Set(rows.map((r) => r.id))
  return userIds.filter((id) => !known.has(id))
}
