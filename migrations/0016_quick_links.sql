-- The links on the dashboard that are not pages of this app.
--
-- Every ward runs on a handful of URLs that live somewhere else: LCR, the ward
-- calendar, a signup sheet, the building scheduler, a shared drive of music.
-- They were being passed around in texts. One list on the dashboard is the
-- whole feature, so this table is deliberately two columns and an order.
--
-- Shared, not per-account: `user_id` is absent on purpose. These are the ward's
-- links, and a personal list would mean the bishopric's copy of the LCR link
-- differs from everybody else's for no reason. Only admins write — the routes
-- require it, the same way the meeting-hours editor does — so there is no
-- permission key for this either.
--
-- `sort` rather than created_at ordering: the list is short enough that where a
-- link sits in it is a decision somebody makes, and gaps of 10 leave room to
-- drop one in between without renumbering the rest.

CREATE TABLE quick_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL,
  -- Stored with its scheme. Validated in the route rather than by a CHECK: a
  -- constraint that rejects a URL cannot say which part of it was wrong.
  url        text NOT NULL,
  sort       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT quick_links_label_not_blank CHECK (length(btrim(label)) > 0),
  CONSTRAINT quick_links_url_not_blank CHECK (length(btrim(url)) > 0)
);

-- The dashboard reads the whole table in display order, every sign-in.
CREATE INDEX quick_links_sort_idx ON quick_links(sort, created_at);
