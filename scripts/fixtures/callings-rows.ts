/**
 * A miniature ward: one of every shape the org chart has to place — a bishopric
 * with staff, a quorum presidency with a secretary and an assistant, a sub-org
 * whose presidency answers to the bishop, a class presidency that answers to an
 * organization president, a sub-heading full of teachers, and a vacancy.
 *
 * Invented names. Shared by the tree and layout tests.
 */
import type { CallingRecord } from '../../src/lib/org-tree'

let n = 0
function row(
  org_key: string,
  name: string,
  full_name: string | null,
  unit: string | null = null,
  printed_name: string | null = null,
): CallingRecord {
  return {
    id: `c${n}`,
    org_key,
    name,
    unit,
    is_custom: false,
    sort: n++,
    full_name,
    printed_name,
    photo_url: null,
  }
}

export const ROWS: CallingRecord[] = [
  row('bishopric', 'Bishop', 'Marcus Alder'),
  row('bishopric', 'Bishopric First Counselor', 'Dana Whitfield'),
  row('bishopric', 'Bishopric Second Counselor', 'Roland Pike'),
  row('bishopric', 'Ward Executive Secretary', 'Devin Ashcroft'),
  row('bishopric', 'Ward Clerk', 'Tobi Okonkwo'),
  row('bishopric', 'Ward Assistant Clerk', null),
  row('elders_quorum', 'Elders Quorum President', 'Taylor Brennan', 'Elders Quorum Presidency'),
  row('elders_quorum', 'Elders Quorum First Counselor', 'Neil Ramsey', 'Elders Quorum Presidency'),
  row('elders_quorum', 'Elders Quorum Secretary', 'Bruce Ferrer', 'Elders Quorum Presidency'),
  row(
    'elders_quorum',
    'Elders Quorum Assistant Secretary',
    'Manuel Castellano',
    'Elders Quorum Presidency',
  ),
  row('elders_quorum', 'Elders Quorum Teacher', 'James Corbin', 'Teachers'),
  row('elders_quorum', 'Elders Quorum Teacher', null, 'Teachers'),
  // A quorum presidency answers to the bishop, not to a Young Men president —
  // there isn't one; the bishopric presides over the Aaronic Priesthood.
  row('deacons_quorum', 'Deacons Quorum President', 'Jack Prescott', 'Deacons Quorum Presidency'),
  row('deacons_quorum', 'Deacons Quorum Adviser', 'Keith Osgood', 'Deacons Quorum Adult Leaders'),
  row('young_women', 'Young Women President', 'Marta Van Buren', 'Young Women Presidency'),
  // A class presidency answers to the Young Women president.
  row(
    'gatherers_of_light',
    'Gatherers of Light Class President',
    'ElizaJane Jenson',
    'Gatherers of Light Class Presidency',
  ),
  row('primary', 'Primary President', 'Crystal McAlister', 'Primary Presidency'),
  row('primary', 'Primary Teacher', 'Catherine DeWinter', 'Valiant 9'),
  row('primary', 'Primary Teacher', 'Jennifer Mcbride', 'Valiant 9'),
  // Held by somebody with no record in the ward data — shown, not dropped.
  row('deacons_quorum', 'Deacons Quorum Secretary', null, 'Deacons Quorum Presidency', 'Sam Osgood'),
]
