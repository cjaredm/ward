/**
 * The app's sections, and who may see them — and, where a section has one, who
 * may change what is in it.
 *
 * This list is the single source of truth for three things at once: the cards
 * on the dashboard, the checkboxes on the admin user form, and the server-side
 * gate on each section's page. Adding a section means adding one entry here and
 * one route — nothing else has to learn about it.
 *
 * `editKey`, where present, is a second permission held *in the same array* as
 * the section keys. A separate column was the alternative and it is worse: every
 * read of a user would grow a join or a second array to keep in step, and the
 * admin form already renders whatever this list says. The keys cannot collide
 * with section keys because a section key is a bare noun and these are suffixed.
 *
 * Only the building map has one so far. The ward map's own edit gate is the
 * `map` section itself, which is what shipped and what its routes still check;
 * splitting that is a migration of its own and not this change.
 *
 * Admins are not listed against sections; they bypass every check entirely.
 */
export const SECTIONS = [
  {
    key: 'map',
    label: 'Ward Map',
    description: 'Parcels, households and businesses across the ward boundary.',
    href: '/map',
    // Inline SVG path data rather than an icon dependency — one glyph per card.
    icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
  },
  {
    key: 'members',
    label: 'Members',
    description: 'Every person in the ward, searchable, with their household editable inline.',
    href: '/members',
    icon: 'M17 20h5v-1a3 3 0 00-4.35-2.7M17 20H7m10 0v-1c0-.65-.12-1.27-.35-1.83M7 20H2v-1a3 3 0 014.35-2.7M7 20v-1c0-.65.12-1.27.35-1.83m0 0a5 5 0 019.3 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  },
  {
    key: 'org_chart',
    label: 'Org chart',
    description: 'Every organization, its callings, and who holds them.',
    href: '/org-chart',
    icon: 'M12 4a2 2 0 100 4 2 2 0 000-4zm0 4v3m0 0H7a2 2 0 00-2 2v1m7-3h5a2 2 0 012 2v1M5 16a2 2 0 100 4 2 2 0 000-4zm14 0a2 2 0 100 4 2 2 0 000-4z',
  },
  {
    key: 'building',
    label: 'Building map',
    description: 'Rooms in the stake center, and the classes meeting in each hour by hour.',
    href: '/building',
    icon: 'M4 21V6a1 1 0 011-1h6a1 1 0 011 1v15M12 21V10a1 1 0 011-1h6a1 1 0 011 1v11M3 21h18M7 9h2m-2 4h2m-2 4h2m7-4h2m-2 4h2',
    editKey: 'building_edit',
    editLabel: 'Building map — assign classes and fix rooms',
  },
] as const

export type SectionKey = (typeof SECTIONS)[number]['key']

export const SECTION_KEYS: readonly string[] = SECTIONS.map((s) => s.key)

/** The sections that have an edit permission of their own, for the admin form. */
export const EDITABLE_SECTIONS = SECTIONS.filter(
  (s): s is (typeof SECTIONS)[number] & { editKey: string; editLabel: string } => 'editKey' in s,
)

/** Everything a permissions array is allowed to contain. */
export const PERMISSION_KEYS: readonly string[] = [
  ...SECTION_KEYS,
  ...EDITABLE_SECTIONS.map((s) => s.editKey),
]

type Actor = { is_admin: boolean; permissions: string[] }

/** Admins see everything, including sections added after their account was made. */
export function canSee(user: Actor, section: string): boolean {
  return user.is_admin || user.permissions.includes(section)
}

/**
 * May this person change what is in the section, rather than only read it?
 *
 * Seeing it is a precondition, checked here rather than trusted: an array that
 * somehow holds `building_edit` without `building` grants nothing, so a bad
 * write to the column cannot become an escalation.
 *
 * A section with no `editKey` has not split its permissions, and there being
 * read on write would silently grant every viewer write access — so it answers
 * with `canSee`, which is exactly the gate its routes already apply.
 */
export function canEdit(user: Actor, section: string): boolean {
  if (user.is_admin) return true
  const entry = SECTIONS.find((s) => s.key === section)
  if (!entry) return false
  if (!('editKey' in entry)) return canSee(user, section)
  return user.permissions.includes(section) && user.permissions.includes(entry.editKey)
}

export function visibleSections(user: Actor) {
  return SECTIONS.filter((s) => canSee(user, s.key))
}

/**
 * The permissions array as it is allowed to be stored: known keys only, no
 * duplicates, and no edit permission for a section this person cannot open.
 *
 * Applied on the way in rather than only in the UI. The checkbox that turns a
 * section off can drop its edit key on the client, but a PATCH sent by hand — or
 * by an older build of the form — must not be able to leave the pair behind, or
 * re-granting the section later would silently restore write access somebody
 * thought they had removed.
 */
export function normalizePermissions(permissions: string[]): string[] {
  const set = new Set(permissions.filter((p) => PERMISSION_KEYS.includes(p)))
  for (const s of EDITABLE_SECTIONS) {
    if (!set.has(s.key)) set.delete(s.editKey)
  }
  return PERMISSION_KEYS.filter((k) => set.has(k))
}
