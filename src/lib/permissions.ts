/**
 * The app's sections, and who may see them.
 *
 * This list is the single source of truth for three things at once: the cards
 * on the dashboard, the checkboxes on the admin user form, and the server-side
 * gate on each section's page. Adding a section means adding one entry here and
 * one route — nothing else has to learn about it.
 *
 * Admins are not listed against sections; they bypass the check entirely.
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
  },
] as const

export type SectionKey = (typeof SECTIONS)[number]['key']

export const SECTION_KEYS: readonly string[] = SECTIONS.map((s) => s.key)

/** Admins see everything, including sections added after their account was made. */
export function canSee(
  user: { is_admin: boolean; permissions: string[] },
  section: string,
): boolean {
  return user.is_admin || user.permissions.includes(section)
}

export function visibleSections(user: { is_admin: boolean; permissions: string[] }) {
  return SECTIONS.filter((s) => canSee(user, s.key))
}
