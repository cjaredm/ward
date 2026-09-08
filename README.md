# Ward Parcel Map

Private map of Washington County parcels inside one LDS ward boundary, with editable household data.
Next.js 15 · Neon Postgres + PostGIS · MapLibre GL · deployed on Vercel.

See [Plan.md](Plan.md) for the product spec.

## Privacy

This app stores names and home addresses of church members, including minors. It deliberately
stores **no phone numbers and no email addresses** for them — neither LCR report carries those, and
columns nobody fills are columns nobody can leak (see
[migrations/0011_drop_person_contact.sql](migrations/0011_drop_person_contact.sql)). The only email
addresses in the database are the sign-in addresses of the accounts that use the app.

Access is by named account — one email and password per person, granted by an
admin — and the app sends `X-Robots-Tag: noindex`,
disallows all crawlers, and is not connected to any Church system. `.env*` is gitignored —
a leaked `DATABASE_URL` is a full disclosure of everything above.

## First-time setup

### 1. Neon

1. New project at [console.neon.tech](https://console.neon.tech) — Postgres 17, region **AWS US West 2 (Oregon)**.
2. In the SQL Editor:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   ```
3. Copy **both** connection strings from the Connect dialog — the pooled one (host contains
   `-pooler`) and the direct one.

### 2. Local env

```sh
cp .env.example .env.local
openssl rand -base64 32   # AUTH_JWT_SECRET
```

Fill in `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct) and `AUTH_JWT_SECRET`.
There is no app-wide password env var: passwords are per-person, bcrypt-hashed in the `users`
table. Changing `AUTH_JWT_SECRET` signs everyone out.

### 3. Load the data

```sh
npm run migrate          # applies migrations/*.sql once each
npm run seed:boundary    # geojson.json -> ward_boundary
npm run import:parcels   # UGRC county layer -> parcels, clipped to the boundary
npm run import:directory # optional: a ward directory export -> households + people
```

Then make the first account — the only one that cannot be made from inside the app, since
nobody can sign in yet:

```sh
npm run create-user -- you@example.com 'Your Name' --admin
```

It prints a temporary password once. Sign in with it, replace it when prompted, then add
everyone else from **Dashboard → People & access**.

Expected import summary: **539 parcels kept**, 93 of them non-residential (blank `PARCEL_ADD`
— HOA common area, roads, retention basins). Verify the smoke-test parcel landed:

```sql
SELECT parcel_id, address FROM parcels WHERE address ILIKE '%PAINTED VISTA%';
```

### 4. Vercel

1. Push to a **private** GitHub repo, then import it at [vercel.com](https://vercel.com).
2. `vercel.json` already pins functions to `pdx1` (Portland) so they sit in the same AWS
   region as Neon — same-region hop instead of a cross-country round trip on every query.
3. Settings → Environment Variables: add everything from `.env.local` to all three
   environments. `DATABASE_URL_UNPOOLED` is **required** — the build runs
   `sync:boundary` against the direct endpoint (see below).

Push to `main` deploys. That is the whole pipeline.

## The public page

`/` is a public landing page — no session, no ward data. It carries what a visitor needs:
Sunday meeting time and address, the bishopric interview scheduling link, and the handful of
outside links the ward announces (Gospel Living, Member Tools, the meetinghouse locator). All of
it comes from [`src/lib/ward.ts`](src/lib/ward.ts), which is the one place to change a meeting
time or repoint the scheduling link.

Three things make that page public without opening anything else:

- [`middleware.ts`](src/middleware.ts) keeps an exact-match `PUBLIC_PATHS` set. The matcher's
  lookahead is over path *prefixes*, and `/` is the prefix of every route — carving it out there
  would unlock the app.
- [`robots.ts`](src/app/robots.ts) allows `/$` and disallows `/`. Crawlers take the most specific
  match, so the landing page is indexable and nothing behind it is.
- The root layout defaults `robots` to noindex; the landing page is the single override. A page
  added later without thinking about crawlers gets the safe answer.

Sign in is a dialog on that page ([`SignInDialog`](src/components/SignInDialog.tsx)) so a member
does not lose the page they were reading. `/login` still exists — it is where middleware sends an
expired session — and both render the same [`SignInForm`](src/components/SignInForm.tsx).

## Accounts & permissions

Everyone signs in with their own email and password. Signing in lands on the **dashboard** at
`/dashboard` — a grid of the sections that person is allowed to open — not on the map; the map is
one section among several. The installed PWA starts there too, rather than on the public page.

Admins manage people at **/admin/users**:

- **Add person** — name, email, and which sections they can open. A temporary password is
  generated in the browser and shown once; send it to them out of band. Only its bcrypt hash
  reaches the server.
- **Manage** — rename, change email, toggle sections, grant or remove admin, reset the
  password, deactivate.

Some deliberate choices:

- **Deactivate, never delete.** `households.updated_by` and `audit_log.actor` hold the display
  name of whoever made an edit; the person behind those strings has to keep existing.
- **The last active admin cannot be demoted or deactivated.** Getting back in from there needs
  a terminal and the direct database URL, so the API refuses it.
- **Permissions are read from the database on every request**, never from the session cookie.
  The cookie is a 7-day JWT carrying only the user id and display name — a permission baked
  into it would keep asserting itself for a week after being revoked. See
  [src/lib/auth.ts](src/lib/auth.ts).
- **Admins bypass the permission list** rather than being auto-granted every key, so sections
  added later are open to them without a backfill.

Sections live in one place — [src/lib/permissions.ts](src/lib/permissions.ts). Adding one means
adding an entry there and a route under `src/app/(app)/`; the dashboard card, the admin
checkbox and the server-side gate all read from it.

## Quick links

The dashboard carries a short list of links to pages that are not part of this app — LCR, the
ward calendar, a bishopric agenda. They belong to the ward rather than to each account, and only
an admin can change them, but each one carries its own audience.

- **Names only, until you press Edit.** The resting list is labels and nothing else — no
  addresses, no audiences, no buttons. The label *is* the link, so printing a wrapped Google Docs
  URL under each row said nothing the label had not. `Edit` in the section header turns on the
  addresses, the share badges, the per-row buttons and the add form all at once; `Done` puts them
  away.
- **Edited in place, on the dashboard.** Add, rename, repoint, reshare or remove a link from the
  section itself; there is no admin page for it. Four rows that change twice a year do not need
  one. The Edit button only renders for an admin, and
  [the routes](src/app/api/quick-links/route.ts) require one independently.
- **A link is for everyone until it is narrowed.** "Only certain people" turns the picker on and
  the link is then visible to exactly the accounts ticked — plus every admin, who see all of
  them. The list is stored as rows in `quick_link_shares`, and no rows means everybody, so a
  new account needs no backfill and an existing link never quietly closes.
- **The filter is a `WHERE` clause, not a hidden row.** A link somebody may not see is never
  read out of the database for them, so it is not in the HTML either. See `listQuickLinks` in
  [src/lib/quick-links-query.ts](src/lib/quick-links-query.ts).
- **A rename does not reopen a link.** `shared_with` is only rewritten when the PATCH sends it;
  an absent field leaves the audience exactly as it was.
- **Admins are not offered in the picker**, since they already see everything, and neither are
  deactivated accounts. A share belonging to either is still stored, still counted in the row's
  badge, and kept across a save.
- **A missing scheme is fixed, not rejected.** Pasting `lcr.churchofjesuschrist.org` stores
  `https://lcr.churchofjesuschrist.org/`. Anything that is not http(s) after that is refused —
  see `normalizeUrl` in [src/lib/quick-links.ts](src/lib/quick-links.ts).
- **Order is `sort`, in tens**, so a link can be dropped between two others without renumbering.
  There is no UI for it yet; new links land at the end.

Every change writes an `audit_log` row, the same as a household edit.

## Redrawing the ward boundary

`geojson.json` is the source of truth for the boundary. To change it: edit the file, commit,
deploy. Nothing else.

`npm run build` runs [scripts/sync-boundary.ts](scripts/sync-boundary.ts), which makes the
database agree with the file and then re-imports parcels for the new outline. Run it by hand
with `npm run sync:boundary`.

It is cheap to leave in the build because it does nothing when nothing changed:
`ward_boundary.source_sha` holds the SHA-256 of the file the stored boundary came from, so an
unchanged file costs one query. The ArcGIS fetch and the re-import only happen on a build
where the outline actually moved.

**Nothing that holds ward data is ever deleted.** A county parcel that falls outside the new
boundary is kept — not removed — if it has households on it or if anyone has hand-set its
property type or `in_ward` (tracked in `parcels.ward_edited_at`, stamped by the
app on every parcel edit). Those parcels are listed at the end of the run for review. Shrinking
the ward hides nothing you typed in; hand-drawn parcels (`source = 'manual'`) are never touched
at all.

Guard rails:

- **Preview deploys do not sync.** Every branch carries its own `geojson.json`, and letting
  previews write would let a stale branch silently revert production's boundary. Production
  builds and local runs only.
- **Concurrent builds serialize** on a Postgres advisory lock; the second one finds the SHA
  current and no-ops.
- **A failed sync fails the build.** Deploying the old boundary after someone deliberately
  edited the file is the worse outcome. `BOUNDARY_SYNC=warn` downgrades it to a warning,
  `BOUNDARY_SYNC=off` skips it, `BOUNDARY_SYNC=force` runs it even on a preview.

Schema migrations are still **not** in the build — see [scripts/migrate.ts](scripts/migrate.ts).

## Loading a ward directory

[scripts/import-directory.ts](scripts/import-directory.ts) turns a printed directory export
into households, matching each family's address against the county parcels.

```sh
npm run import:directory                       # dry run — prints the plan, writes nothing
npm run import:directory -- --apply
npm run import:directory -- --apply --status active --no-people
```

Input is `data/directory.tsv`: `<name as printed><TAB><address as printed>`, one per line, name
split at the first comma. **`/data/` is gitignored** — it is a list of real names and home
addresses, and git history is forever.

Where each family lands:

| directory row | result |
| --- | --- |
| address matches a parcel | household on that parcel |
| address matches a parcel marked **business** | pin dropped at that parcel's centroid |
| address matches nothing, street is known | pin interpolated between its numbered neighbours |
| address matches nothing at all | pin parked at the ward centre |
| no address printed | pin parked at the ward centre |

Several families at one address become several households on one parcel — 1579 S Scenic Sunrise
Dr takes four. Two rows sharing an address *and* a surname become one household with two people.

Matching is by house number plus street name, with the directional and the street type used only
to break ties, so `1594 Amity Lane` finds `1594 S AMITY LN`. A one- or two-character typo in the
street name is forgiven within the same house number (`1651 E Sunscrest Cir` →
`1651 E SUNCREST CIR`). Anything genuinely ambiguous is pinned rather than guessed at, and every
non-exact match is printed for review.

Re-running adds nothing twice: a family already on that parcel, or already pinned with that
address, is skipped. The script only ever inserts — it never updates or deletes — so hand-edits
made in the app always win.

Pins parked at the ward centre are meant to be dragged onto their houses: press and drag a pin
on the map, on desktop or on a phone.

The address matching and pin placement live in
[src/lib/import/place.ts](src/lib/import/place.ts), shared with the member-list upload in the app
so the two importers cannot drift apart.

## Members

**Members** (`/members`) is the ward as a list: one line per person, with their family, the address
they are listed at and the callings they hold. The map answers *who lives here*; this page answers
*where is this person*, which is the question somebody with a name in hand actually has.

- **Search** matches name, family name, address and calling, so "clerk" and "Amity" both find rows.
- **Filter by status** narrows to move-ins, less-active, vacant, and so on — the same statuses and
  the same colour dots the map draws.
- **Tap a row** to open the household inline. It is the *same form* the map panel opens
  ([src/components/HouseholdForm.tsx](src/components/HouseholdForm.tsx)), shared by both so a
  correction made here cannot behave differently from one made there: autosave on blur, an explicit
  Save, add or remove people, and Delete this household.

Two rows of the same family open one editor — they are one record, and two live copies of it would
race each other's autosave. Callings stay read-only: they come from the LCR report and hand-edits
here would be overwritten by the next upload.

The whole list is read on page load and filtered in the browser. A ward is a few hundred people;
a round trip per keystroke on a phone is the slower design.

Existing non-admin accounts need the **Members** section ticked at `/admin/users` before the card
shows up for them; admins see it already.

## Callings and the org chart

**Org chart** (`/org-chart`) shows the ward two ways, and remembers which one you last used:

- **List** — every organization, the callings in it and who holds them, in the order LCR printed
  them, so a presidency reads as a presidency rather than as four people sorted alphabetically.
- **Chart** — the same data as a line of authority. Presidents hang off the bishop, counselors and
  the secretary off their president, an assistant off the secretary, and everyone else off the
  sub-heading they were printed under. A quorum presidency answers to the bishop, because the
  bishopric presides over the Aaronic Priesthood; a class presidency answers to the Young Women
  president.

Vacant callings are shown in both, because the openings are the point of the page.

The chart runs **sideways** by default — one column per level, people stacked down the page. Drawn
downward a ward is about 25,000 points wide and legible only when zoomed out past reading size;
sideways it is roughly 1,100 wide and as long as it needs to be, so the first paint is readable and
the rest is a scroll. *Top-down* switches to the classic shape, *Fit* shrinks the whole thing into
view, *100%* returns to full size. Drag to pan, scroll or pinch to zoom, tap a box to open or close
what is under it. Sub-headings start collapsed with a `+N` badge, so the opening view is the
presidencies.

A calling whose holder has no record in the ward data yet is shown in blue with the name as the
report printed it, rather than dropped — the report says somebody holds it, and the ward's own
records simply have not caught up. Those link themselves up once the people exist.

Existing non-admin accounts need the **Org chart** section ticked at `/admin/users` before the
card shows up for them; admins see it already.

Three reports feed this: the callings report below, the organization rosters after it, and the
member list further down. None of them is typed in by hand.

Callings arrive by uploading LCR's report rather than being typed in. In LCR: **Reports →
Organizations and Callings → Export to PDF**, then **Import from LCR** (`/admin/import`, admins
only) → *Preview changes*. Nothing is written until you press *Apply*, and the preview is the
whole plan:

| in the preview | means |
| --- | --- |
| **New callings** | matched a person who does not hold this calling yet |
| **Unchanged** | already recorded exactly as printed |
| **Released** | held right now, absent from this report — a reorganization |
| **Vacant** | printed as *Calling Vacant*; kept, not dropped |
| **Ambiguous** | more than one person answers to that name — left for a human |
| **No such person** | nobody in the ward data matches; usually a member who was never imported |

The report is authoritative for the organizations it contains, so a calling that has fallen off it
is **released** — soft, so who held what stays answerable. Releases are listed by name in the
preview before you apply. Re-uploading the same file is a no-op.

Three things get written: a `callings` row per calling (many per person — a clerk is usually two,
and an unmatched holder is stored with their printed name and no person attached),
a `person_orgs` row per organization the person now belongs to, and one `import_batches` row
recording counts only. Names never go into the audit trail.

Names are matched on the parts that survive both spellings — surname plus first given name — so
`Prescott, Haven Tyler` finds `Haven Prescott` and `Mc Alister, Crystal` finds `Crystal McAlister`.
Anything matching two people is reported, never guessed at.

Organizations are a tree in the `orgs` table: coarse at the top (Elders Quorum, Relief Society,
Young Men, …) with the children the report already prints (Deacons Quorum under Young Men, Nursery
under Primary). Breaking one down further later is an INSERT, not a data migration.

Both halves of the parser are covered without a database or a real report:

```sh
npm run test:callings    # renders scripts/fixtures/callings-sample.txt into a real PDF, parses both ways
npm run test:rosters     # organization rosters, every heading shape, broken across pages
npm run test:members     # member list, including a member split across a page break
npm run test:match       # report name -> person, including the cases that must stay ambiguous
npm run test:orgtree     # who ends up under whom
npm run test:orglayout   # chart geometry: no overlaps, parents centred, both orientations
npm run test:mapgroups   # the groups the map highlights, and the order they are offered in
```

Once the whole ward's callings are in, each person in the map panel shows their callings as chips.
They are read-only there — the next upload is the source of truth.

### Organization rosters

The same LCR report with **Include members** ticked prints a roster per organization and per class:
*Elders Quorum Members*, *Gatherers of Light Members*, *Valiant 9 Members*, *Course 15 Members*.
Upload it on `/admin/import` under **Organization rosters**, same preview-then-apply flow.

This is the difference between who **serves** in an organization and who **belongs** to it. Before
it, `person_orgs` was written only by the callings import, so highlighting Young Women on the map
lit up the presidency's four houses. Now it lights up the nine Gatherers of Light girls as well,
with their two advisers marked as serving rather than merely listed.

A class is not an org. *Gatherers of Light* and *Deacons Quorum* are seeded orgs, but *Course 15*,
*Valiant 9* and *Primary Activities - Boys 9 & 10* are ward-specific and renumber every January —
so membership carries a `unit` the way `callings` already does, and `''` means the organization
itself. A membership rolls up one level: a Valiant 9 child is in Valiant 9 and in Primary.

Both importers write memberships and sometimes the same one, so `source` is part of the primary key
of `person_orgs`. Each owns its own rows: a roster re-import removes what the last roster said and
never touches what the callings report said.

Two rows in the preview are worth reading before applying:

| in the preview | means |
| --- | --- |
| **Same person twice** | two names on the report matched one person — held back, not guessed |
| **Rosters** table | rows read against the `Count:` LCR printed under each roster |

The first one is the trap. The report prints `Richards, Colter` in the Elders Quorum and
`Richards, Colter Tymber` in Valiant 9 — father and son, with only the father in the ward data —
and the matcher's tolerance for middle names is exactly what makes the son look like the father. A
wrong guess there has no visible symptom: the class highlight would show a grown man's name and
look entirely reasonable. So when two printed names land on one person, both are skipped and
reported. Add the missing people, then upload the file again.

The rosters table is a check the report itself can settle, since LCR prints its own counts: a
roster that reads short of its printed count is a parse problem, not a class that shrank.

### The member list

**Reports → Member List → Export to PDF**, then the same preview-then-apply flow on
`/admin/import`. It reads the two-column report, including the awkward parts: a three-line address
with the name set against its middle, a member whose address is cut in half by a page break, and
the members LCR prints with no address at all.

Members are grouped into households by **address plus surname** — four families share 1579 S
Scenic Sunrise Dr, so address alone would merge them — and each household is placed exactly the way
the directory script places one: onto the county parcel at that address, or interpolated between
its numbered neighbours, or parked at the centre of the ward to be dragged onto its house.

The import is **additive only**:

| in the preview | what Apply does |
| --- | --- |
| New people, new households | creates them |
| Address differs | **nothing** — listed so a person can move the household on the map |
| Not on the report | **nothing** — listed, never deleted |

Moving a family is a decision about which house on the map they now live in, and the map holds
hand-placed pins and notes a report cannot know about. So the report never overwrites it.

Applying also **links up the callings** left hanging by the callings import: a calling stored with a
printed name now points at the person, where exactly one person answers to that name. Run the
member list first and the callings report second and almost nothing is left unlinked.

## Naming the businesses

A parcel marked **Business** holds a list of tenants — many per parcel, the same shape
households already have, because one unit on Sandhill Dr holds six of them. The first tenant is
the name the map prints; a shared unit prints `Knox AutoWurx  +5`. Edit them in the parcel panel.

[scripts/import-businesses.ts](scripts/import-businesses.ts) fills them in from
[Overture Maps](https://overturemaps.org) rather than by hand:

```sh
npm run import:businesses                      # dry run — prints the plan, writes nothing
npm run import:businesses -- --apply
npm run import:businesses -- --min-confidence 0.6
```

Input is `data/overture-places.json`, committed because it is public business names with no
member data in it. Regenerate it when the ward looks stale:

```sh
pip install duckdb && npm run fetch:places
```

Overture rather than OpenStreetMap because of coverage: OSM knows six businesses inside this
boundary and Utah's statewide address points know two. Overture carries the Meta and Microsoft
POI sets and knows about 140, which names roughly two thirds of the industrial park. The data is
CC BY 4.0; imported rows are labelled *From Overture Maps* in the panel until somebody edits
them, at which point they become hand-entered and no re-import will touch them.

Each POI matches a parcel by coordinate first, and by county address second — one POI in six is
geocoded to the street or the wrong end of a building. An address-only match is only ever
allowed onto a parcel **already marked as a business**: it is not strong enough to put a shop
name on somebody's house. Parcels that already have a tenant are skipped entirely, which covers
both hand-typed names and a tenant somebody deliberately deleted.

## Highlighting an organization

The dropdown at the top of the map's legend card lists every organization and every class the ward
has anybody in. Pick one and its members' homes keep their status colour at full strength while the
rest of the ward drops back to a hint of one, ringed and named from two zoom levels further out
than the ordinary labels.

The ring, the labels and the card around the list are all drawn in **the organization's own colour
from the org chart** — teal for the elders quorum, orange for the Primary, purple for the Young
Women classes. The palette is [`ORG_TINT` in src/lib/orgs.ts](src/lib/orgs.ts), shared by both
screens rather than copied into each: a quorum that is teal on the chart and magenta on the map is
two things to learn instead of one. A class takes its organization's colour, exactly as it does on
the chart. Map labels use a darkened step of the same hue (`orgInk`), because the lighter tints —
`#60a5fa` for the deacons — are unreadable at 11px over nothing but a white halo.

*Zoom to fit* frames the whole group; *List* opens the homes as rows, and tapping one flies to it
and opens the household.

List rows read **Surname, Given name** in bold with the calling under it — surname first because
these lists are scanned down for a family, and on two lines because callings like *Primary
Activities - Boys 9 & 10 Specialist* do not share one. Any line the card is too narrow for gets a
tooltip carrying the whole thing, and only then: a `title` on every line would mean hovering a
perfectly readable name pops a box repeating it back.

Two kinds of group are offered, because the ward's data supports two:

- **Organizations** — everyone `person_orgs` places in an org. That table is written by the callings
  import, so it is who *serves* in an org rather than who attends it: the ward has no roster of
  attendance to draw on. A parent org rolls up its children, so Young Men includes the deacons
  quorum adviser and lists him by that calling.
- **Classes and groups** — the sub-headings LCR prints a calling under: *Valiant 9*, *Course 15*,
  *Ministering*, *Relief Society Presidency*. This is as close to a class roster as the report gets.
  They are labelled with the org they sit in, because half of them are called *Presidency* or
  *Teachers* and name nothing on their own.

Two things the highlight deliberately does not do. It does not repaint the homes — "which of these
families is less active" is still a question you have while looking at a quorum, so the highlight is
carried by the outline and the dimming instead of a second fill colour. And it overrides the legend
filters: asking for the Primary and being handed nine of its twelve homes, because three are marked
less-active and that key happens to be switched off, is a wrong answer given silently.

Households with no parcel *and* no pin cannot be drawn at all. The card counts them — *3 not on the
map* — rather than quietly shrinking the group.

The whole index ships in one request from [`/api/orgs/groups`](src/app/api/orgs/groups/route.ts):
a ward's rosters are a few hundred rows either side, which is smaller than one round trip's latency,
so switching groups is instant on the sort of phone signal this app is used on. The grouping itself
is pure ([src/lib/map-groups.ts](src/lib/map-groups.ts)) and covered by `npm run test:mapgroups`.

## Building map

`/building` is the stake center floorplan with the rooms drawn on it, and what meets in each room
hour by hour. It answers the question the ward map and the org chart cannot: which room is Course 15
in this hour, and which rooms are sitting empty.

**First-time setup.** Save the floorplan viewer HTML to `data/floorplan-viewer.html`
(or `data/floorplan.html` — the seed accepts either name), then:

```bash
npm run migrate               # creates the four tables and the two 25-minute blocks
npm run seed:building -- --dry-run   # lists the rooms it found, writes nothing
npm run seed:building         # writes public/floorplan/stake-center.svg and the room rows
```

The seed derives two things from that one file: the wall drawing, written out as a static SVG the
page loads as an `<image>`, and one row per room from the `<g id="rooms">` outlines. It is safe to
re-run — rooms insert `ON CONFLICT DO NOTHING` and are never updated, so an outline you have
corrected in the app is never reverted by a later seed.

**Access is two permissions**, both per account on [/admin/users](src/app/(app)/admin/users):
**Building map** to open it, and **and change it** underneath to assign classes, close a room for an
hour, trace or reshape an outline, or delete a room. Read-only is the useful state rather than a
degraded one — most of the ward wants to know which room a class is in, and two people should be
moving classes around. Turning the section off takes its edit permission with it, on the client and
again in the API, so re-granting the section a month later does not silently restore write access.
The edit permission alone grants nothing.

Enforced by `requireSectionEdit('building')` on every write handler and `canEdit` on the page, which
is what decides whether the panel renders its forms; the hidden buttons are a courtesy, and the route
check is the gate. `npm run test:permissions` covers both. Editing the *hours* stays admin-only — it
changes the schedule for the whole ward, not one room.

**Hours.** The blocks a Sunday is divided into are data, not code — an admin edits them from the
Hour card on the map itself. Moving the 9:10 block to 9:15 keeps every class already assigned to it,
because an assignment references the block by an opaque id rather than by its time. A block that is
not meeting this year gets switched off rather than deleted, so what met in it is still there when
it comes back; deleting one is refused while anything is assigned to it.

**Classes.** Each room takes any number of classes per block — the cultural hall really does hold two
at once, and `104 / 105 / 106` is one traced outline over three rooms. A class is a name you type,
optionally linked to a ward class the app already knows about.

The picker offers only what takes a classroom, under five headings —
**Sunday School** (Adult Sunday School, Course 11–17), **Primary** (CTR, Sunbeam, Valiant, and
Nursery, which is an org of its own), **Young Women** and **Young Men** (their three classes and
three quorums), and **Adults** (Relief Society, Elders Quorum, which meet as whole organizations
because they have no parts to break into). `CLASS_SECTIONS` in
[src/lib/building.ts](src/lib/building.ts) is that whitelist, and it is a whitelist on purpose: the
imports also produce presidencies, committees, activity groups, organizations that never take a room
(Bishopric, Ward Missionaries, Temple and Family History) and whole-org entries whose parts are what
actually meet — nobody schedules 'Young Men' into a room, they schedule three quorums into three of
them. Within a heading the list is alphabetical, with numeric collation so Valiant 10 follows
Valiant 9 and Course 9 does not land after Course 17. Presidencies and committees are caught by the
roster test as well: a class has people enrolled in it, a presidency has callings and nobody
enrolled. The Primary activity groups are the exception LCR prints with a full roster, so they are
excluded by name in `NOT_A_CLASS`.

A class that already has a room in that hour is not offered a second one — it comes out of the list
for that hour only, since Course 15 meets twice on some Sundays. Editing an assignment keeps its own
class in its own picker. This only applies to classes that are *linked*: a title typed by hand
cannot be matched, because 'Course 15' and 'Course 15 (combined)' are the same class and different
strings. The link is the `(org_key, unit)` pair
the callings and roster imports already use, which is what will let a room show its roster and its
teachers later; the name you typed stays what gets printed. Putting the same class in two rooms in
one hour is allowed and warned about, not blocked.

**The controls.** `/building` has no header band. A floorplan is wider than it is tall, so the empty
paper is along the top, and everything floats there instead: the hour chip, the four tools, and the
page's nav pinned to the right. Under the bar's left end sits the key, or the outline editor while
tracing. Zoom is bottom-right, where a thumb is. Every card folds to its own title bar — the hour
chip keeps saying which hour is showing, and the key folds away once it has been read — and both
start folded on a screen under 600px tall, which is a phone held sideways. The key scrolls inside
itself with the Hide button at the top, above the colours it applies to. The bar wraps on a phone,
where all of it is about 440px and the screen is 375: `order` keeps the hour and the nav on the first
line and drops the tools below them. The page title and its counts live behind the **About this map**
button.

**Dashboard is a menu item**, not a button of its own, on every page. Two controls is two controls to
fit into every header, and the second one duplicated the first line of the menu beside it. The menu
hangs from the right edge and scrolls: anchored left it runs off the side of a phone, and a ward with
every section granted plus the admin pages is taller than a phone held sideways.

Confirmations and the room-name prompt are the app's own dialog
([src/components/Dialog.tsx](src/components/Dialog.tsx)) rather than `window.confirm` /
`window.prompt`: the native ones print the hostname above the question on iOS, block repaints while
open, and return null — indistinguishable from Cancel — once a browser has been told to suppress
further dialogs. Buttons come from `btnPrimary` / `btnQuiet` / `btnDanger` /
`btnSmall` in [src/components/form-styles.ts](src/components/form-styles.ts), which carry the 44px
touch target, the padding and the type size together, rather than each call site remembering.

**Tracing and fixing a room.** The trace tool works like the ward map's: tap each corner, then Save.
Unlike the ward map, a saved outline can be *fixed* — open a room and press **Fix outline** to drag
its corners, tap a ⊕ on a wall to add one, or select a corner and remove it. Escape backs out one
layer at a time; Backspace drops the last corner while tracing.

**Availability.** A room has one building-wide switch — *Classes meet in here*, off for the hallways
and the serving area — and, on top of it, an answer per hour. The chapel holds classes and is still
not free during sacrament meeting, so each hour in a room's panel has its own **Available** tick.
Only the overrides are stored: ticking it back on removes the row rather than storing a `true`, so a
new hour inherits the building instead of arriving as thirty-five rows that mean nothing. Closing an
hour that still has a class in it is refused with the count, and so is scheduling into a closed hour.

**Reading it.** Every room is painted by what it is doing in the hour on screen: **green** with a
class in it, **yellow** free, **grey** for the hallways and anything closed for that hour. The key in
the corner paints the same three swatches, and its button takes the grey rooms off the drawing
altogether — a plan where half the outlines can never be an answer is a hard plan to schedule
against. The organization's colour moved to the label rather than the fill, so a green room still
reads as Primary or Relief Society at a glance. Labels are drawn at a constant screen size and step down from the
class name to an abbreviation to the room number to nothing as the room gets smaller on screen,
rather than scaling with the room and rendering the cultural hall in 80px type. The list button
gives the same hour as a table, which is what prints and what works in a hallway.

The geometry is not PostGIS. A room outline is SVG units on the drawing with Y pointing down, and
there is no SRID that is honest about that — `ST_Area(::geography)` on those numbers returns a
plausible figure that means nothing. Outlines live in `jsonb` and the maths lives in
[src/lib/floorplan-geom.ts](src/lib/floorplan-geom.ts), covered by `npm run test:floorplan`, with
`npm run test:building` and `npm run test:buildinglabels` over the schedule and label logic.

## Satellite

The Map / Satellite toggle in the legend switches the basemap to Esri World Imagery — no API key,
attribution shown on the map — with OpenFreeMap's roads, street names and place labels still
drawn on top, so it is a hybrid rather than bare photos. The choice is remembered per device.

[`applySatellite`](src/lib/map-style.ts) edits the live style in place instead of swapping
styles: `setStyle` would tear down the parcel source and rebuild it, flashing the whole ward and
dropping the selection. It hides everything that paints ground, slots the imagery under the
first road line, flips labels to white-on-dark, and hands back a function that puts all of it
back.

Imagery stops at z19 here, which is why the source is capped there — uncapped, MapLibre asks for
z20 and gets blank tiles instead of overzooming the z19 ones.

Esri's capture does not sit exactly on the county's survey — over this ward it is about **four
metres north**, enough that every lot reads as sitting south of its house. That correction is
applied by default (`DEFAULT_IMAGERY_NUDGE` in [src/lib/map-style.ts](src/lib/map-style.ts)); nobody
has to know it exists.

The control that changes it is folded behind **Imagery alignment** at the bottom of the tools
card, visible only in satellite. It is a one-time calibration, not a field control — the reason to
open it is Esri reflying the area. Arrows move the photo in one-metre steps, the reading resets to
the built-in default, and an adjustment is remembered per device.

MapLibre has no `raster-translate`, so the correction moves the ward layers the other way with
`fill-translate` / `line-translate` / `circle-translate` / `text-translate` — the same picture, and a
paint property, so nothing in the database moves. `*-translate` is in screen pixels, which would
be the wrong ground distance at every zoom but one; a metre is worth twice as many pixels per
zoom level, so an `["exponential", 2]` zoom interpolation between two stops holds the offset at a
constant distance on the ground (verified exact from z12 to z22).

Anything written from a map click — a dropped pin, a traced outline, a dragged pin — has the
offset subtracted back off first, so what you point at is what gets stored. `queryRenderedFeatures`
already accounts for translate, so taps still select the parcel you can see.

## Monthly refresh

UGRC republishes the county layer monthly. Before each refresh:

```sh
npm run test:clobber     # proves the import does not destroy household data
npm run import:parcels
```

`test:clobber` seeds a household plus a business plus the manual `in_ward` / `use_type` /
`ward_edited_at` overrides on a **county** parcel, re-runs the import, and asserts everything
survived. If it fails, **do not run the refresh** — the import is eating months of hand-entered
work.

## Notes

- **Migrations never run in the Vercel build.** Builds run on every preview and can run
  concurrently; concurrent schema migrations corrupt databases. Run `npm run migrate` from a
  terminal before pushing code that needs it. The boundary sync is different and does run in the
  build — it is idempotent, SHA-gated and lock-protected; see above.
- The app runtime uses the Neon **HTTP** driver ([src/lib/db.ts](src/lib/db.ts)); scripts use a
  plain `pg` TCP client on the direct URL ([scripts/lib/pg.ts](scripts/lib/pg.ts)). Both on
  purpose — see the comments in each.
- `/api/parcels` ships the whole ward as one GeoJSON FeatureCollection (~320 KB, 52 KB gzipped).
  No vector tiles: at 539 parcels a tile pyramid solves a problem that does not exist.
- `npm audit` reports 3 high findings in Next 15's own transitive `postcss` and `sharp`. Both
  are build-time; clearing them requires Next 16, which the spec pins against.
