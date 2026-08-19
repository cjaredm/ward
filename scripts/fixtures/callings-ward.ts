/**
 * A full-sized ward: every organization the seed knows about, a presidency in
 * each, sub-headings full of teachers and ministering brothers, and a Primary big
 * enough to wrap into a second column.
 *
 * The small fixture cannot catch a grid or corridor bug — with six organizations
 * everything fits in one band and no line has to go round anything. This one has
 * eighteen. Invented names, generated so the file stays readable.
 */
import type { CallingRecord } from '../../src/lib/org-tree'

let n = 0
function row(
  org_key: string,
  name: string,
  full_name: string | null,
  unit: string | null = null,
): CallingRecord {
  return {
    id: `c${n}`,
    org_key,
    name,
    unit,
    is_custom: false,
    sort: n++,
    full_name,
    printed_name: null,
    photo_url: null,
  }
}

const first = ['Marcus', 'Dana', 'Roland', 'Devin', 'Tobi', 'Taylor', 'Neil', 'Bruce', 'Manuel', 'James', 'Jack', 'Keith', 'Marta', 'Eliza', 'Crystal', 'Catherine', 'Jennifer', 'Peter', 'Alma', 'Ruth']
const last = ['Alder', 'Whitfield', 'Pike', 'Ashcroft', 'Okonkwo', 'Brennan', 'Ramsey', 'Ferrer', 'Corbin', 'Prescott', 'Osgood', 'Van Buren', 'Jenson', 'McAlister', 'DeWinter', 'Mcbride']
let p = 0
const person = () => `${first[p % first.length]} ${last[(p++ * 7) % last.length]}`

export const WARD_ROWS: CallingRecord[] = [
  row('bishopric', 'Bishop', person()),
  row('bishopric', 'Bishopric First Counselor', person()),
  row('bishopric', 'Bishopric Second Counselor', person()),
  row('bishopric', 'Ward Executive Secretary', person()),
  row('bishopric', 'Ward Clerk', person()),
  row('bishopric', 'Ward Assistant Clerk', null),
  row('elders_quorum', 'Elders Quorum President', person(), 'Elders Quorum Presidency'),
  row('elders_quorum', 'Elders Quorum First Counselor', person(), 'Elders Quorum Presidency'),
  row('elders_quorum', 'Elders Quorum Second Counselor', person(), 'Elders Quorum Presidency'),
  row('elders_quorum', 'Elders Quorum Secretary', person(), 'Elders Quorum Presidency'),
  row('elders_quorum', 'Elders Quorum Assistant Secretary', person(), 'Elders Quorum Presidency'),
  ...Array.from({ length: 6 }, () => row('elders_quorum', 'Elders Quorum Teacher', person(), 'Teachers')),
  ...Array.from({ length: 9 }, () => row('elders_quorum', 'Ministering Brother', person(), 'Ministering')),
  row('relief_society', 'Relief Society President', person(), 'Relief Society Presidency'),
  row('relief_society', 'Relief Society First Counselor', person(), 'Relief Society Presidency'),
  row('relief_society', 'Relief Society Secretary', person(), 'Relief Society Presidency'),
  ...Array.from({ length: 5 }, () => row('relief_society', 'Relief Society Teacher', person(), 'Teachers')),
  ...Array.from({ length: 4 }, () => row('relief_society', 'Relief Society Activities Committee', person(), 'Activities')),
  row('young_men', 'Young Men President', person(), 'Young Men Presidency'),
  row('young_men', 'Young Men First Counselor', person(), 'Young Men Presidency'),
  row('priests_quorum', 'Priests Quorum Assistant', person(), 'Priests Quorum Presidency'),
  row('priests_quorum', 'Priests Quorum Adviser', person(), 'Priests Quorum Adult Leaders'),
  row('teachers_quorum', 'Teachers Quorum President', person(), 'Teachers Quorum Presidency'),
  row('teachers_quorum', 'Teachers Quorum Adviser', person(), 'Teachers Quorum Adult Leaders'),
  row('deacons_quorum', 'Deacons Quorum President', person(), 'Deacons Quorum Presidency'),
  row('deacons_quorum', 'Deacons Quorum Secretary', null, 'Deacons Quorum Presidency'),
  row('deacons_quorum', 'Deacons Quorum Adviser', person(), 'Deacons Quorum Adult Leaders'),
  row('young_women', 'Young Women President', person(), 'Young Women Presidency'),
  row('young_women', 'Young Women First Counselor', person(), 'Young Women Presidency'),
  row('gatherers_of_light', 'Gatherers of Light Class President', person(), 'Gatherers of Light Class Presidency'),
  row('gatherers_of_light', 'Gatherers of Light Class Adviser', person(), 'Gatherers of Light Class Adult Leaders'),
  row('messengers_of_hope', 'Messengers of Hope Class President', person(), 'Messengers of Hope Class Presidency'),
  row('builders_of_faith', 'Builders of Faith Class President', null, 'Builders of Faith Class Presidency'),
  row('primary', 'Primary President', person(), 'Primary Presidency'),
  row('primary', 'Primary First Counselor', person(), 'Primary Presidency'),
  row('primary', 'Primary Secretary', person(), 'Primary Presidency'),
  ...Array.from({ length: 8 }, (_, i) => row('primary', 'Primary Teacher', person(), `Valiant ${8 + i}`)),
  ...Array.from({ length: 6 }, () => row('primary', 'Primary Music Leader', person(), 'Music')),
  row('nursery', 'Nursery Leader', person(), 'Nursery'),
  row('nursery', 'Nursery Worker', person(), 'Nursery'),
  row('sunday_school', 'Sunday School President', person(), 'Sunday School Presidency'),
  ...Array.from({ length: 5 }, () => row('sunday_school', 'Sunday School Teacher', person(), 'Teachers')),
  row('ward_missionaries', 'Ward Mission Leader', person()),
  ...Array.from({ length: 4 }, () => row('ward_missionaries', 'Ward Missionary', person(), 'Ward Missionaries')),
  row('temple_family_history', 'Ward Temple and Family History Leader', person()),
  ...Array.from({ length: 3 }, () => row('temple_family_history', 'Temple and Family History Consultant', person(), 'Consultants')),
  row('young_single_adult', 'Young Single Adult Leader', person()),
  ...Array.from({ length: 4 }, () => row('other', 'Ward Music Chair', person(), 'Other Callings')),
]
