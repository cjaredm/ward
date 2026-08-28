-- Who a quick link is for, when it is not for everybody.
--
-- 0016 made the links the ward's: one list, every signed-in account sees it.
-- That is right for LCR and the calendar and wrong for the half of them that
-- are somebody's working document — a bishopric agenda, the ministering
-- spreadsheet, a draft schedule nobody should be reading yet.
--
-- Three decisions:
--
-- 1. Explicit people, not a permission key. The sections in
--    src/lib/permissions.ts are areas of the app and churn on migrations; the
--    audience for a link is "these four people", named by an admin at the
--    moment they paste it. A key per link would mean a migration per link.
--
-- 2. No rows means everybody. Absence is the open state, so every link that
--    already exists stays visible without a backfill, and a link is public
--    until somebody deliberately narrows it. The alternative — rows for
--    everyone by default — turns adding an account into a job of pasting it
--    into every public link.
--
-- 3. Admins are not stored here. They bypass the check in the query, the same
--    way they bypass `users.permissions`, so an admin's own account never has
--    to appear in a share list to see what they just created.
--
-- CASCADE on both sides: a share is a fact about a link and a person, and it
-- has no meaning once either is gone. Deactivating an account leaves its rows
-- alone — deactivation is reversible and the audience should survive it.

CREATE TABLE quick_link_shares (
  link_id    uuid NOT NULL REFERENCES quick_links(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (link_id, user_id)
);

-- The dashboard asks "which links am I allowed to see" once per sign-in, which
-- is a lookup by user; the primary key covers the editor's per-link read.
CREATE INDEX quick_link_shares_user_idx ON quick_link_shares(user_id, link_id);
