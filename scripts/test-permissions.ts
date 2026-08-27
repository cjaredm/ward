/**
 * Exercises who may see and who may change each section. No database.
 *
 *   npx tsx scripts/test-permissions.ts
 *
 * The gate itself is `requireSection` / `requireSectionEdit` in src/lib/auth.ts,
 * which resolves the cookie and then asks these functions. These are the part
 * worth testing without a server: everything about the answer that is not the
 * cookie lives here.
 */
import {
  EDITABLE_SECTIONS,
  PERMISSION_KEYS,
  SECTION_KEYS,
  canEdit,
  canSee,
  normalizePermissions,
} from '../src/lib/permissions'
import { run } from './lib/run'

const who = (permissions: string[], is_admin = false) => ({ is_admin, permissions })

run(async () => {
  const failures: string[] = []
  const check = (cond: boolean, why: string) => {
    if (!cond) failures.push(why)
  }

  // --- seeing a section -----------------------------------------------------
  check(canSee(who(['building']), 'building'), 'the section permission opens the section')
  check(!canSee(who([]), 'building'), 'no permission, no section')
  check(canSee(who([], true), 'building'), 'an admin sees every section')
  check(
    !canSee(who(['building_edit']), 'building'),
    'the edit permission alone does not open the section',
  )

  // --- changing a section --------------------------------------------------
  check(
    canEdit(who(['building', 'building_edit']), 'building'),
    'both permissions together allow a write',
  )
  check(
    !canEdit(who(['building']), 'building'),
    'the section alone is read-only — this is the whole point of the split',
  )
  check(
    !canEdit(who(['building_edit']), 'building'),
    'an edit permission with no section grants nothing, so a bad write to the column is not an escalation',
  )
  check(canEdit(who([], true), 'building'), 'an admin may change every section')
  check(!canEdit(who(['building', 'building_edit']), 'nonsense'), 'an unknown section grants nothing')

  // A section that has not split its permissions must not silently become
  // read-only for everybody who holds it — its routes check the section itself.
  check(
    canEdit(who(['map']), 'map'),
    'a section with no edit permission of its own falls back to being able to see it',
  )
  check(!canEdit(who([]), 'map'), 'and still refuses somebody who cannot see it')

  // --- the keys themselves -------------------------------------------------
  check(
    EDITABLE_SECTIONS.every((s) => !SECTION_KEYS.includes(s.editKey)),
    'an edit key must never collide with a section key, or granting one would grant the other',
  )
  check(
    PERMISSION_KEYS.length === SECTION_KEYS.length + EDITABLE_SECTIONS.length,
    'every key is either a section or one section’s edit permission',
  )

  // --- normalizing what gets stored ----------------------------------------
  check(
    JSON.stringify(normalizePermissions(['building_edit'])) === JSON.stringify([]),
    'an edit permission with no section is dropped rather than stored',
  )
  check(
    JSON.stringify(normalizePermissions(['building', 'building_edit'])) ===
      JSON.stringify(['building', 'building_edit']),
    'a complete pair survives',
  )
  check(
    JSON.stringify(normalizePermissions(['building', 'building', 'building'])) ===
      JSON.stringify(['building']),
    'duplicates collapse',
  )
  check(
    JSON.stringify(normalizePermissions(['nope', 'building'])) === JSON.stringify(['building']),
    'an unknown key is discarded, not stored for a section that may exist later',
  )
  check(
    JSON.stringify(normalizePermissions(['building_edit', 'building'])) ===
      JSON.stringify(['building', 'building_edit']),
    'the stored order is the declared order, so two equal permission sets compare equal',
  )

  console.log()
  if (failures.length > 0) {
    for (const f of failures) console.log(`FAIL  ${f}`)
    process.exitCode = 1
    return
  }
  console.log('ok — permissions')
})
