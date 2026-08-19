'use client'

import { useEffect, useMemo, useState } from 'react'
import { ORGS, orgLabel } from '@/lib/orgs'
import { buildOrgTree, type CallingRecord } from '@/lib/org-tree'
import Avatar from './Avatar'
import OrgChartGraph from './OrgChartGraph'

type View = 'list' | 'chart'

const STORAGE_KEY = 'ward:org-chart-view'

/**
 * The org chart, two ways.
 *
 * List is the reference: every organization, every calling, in the order LCR
 * printed them, readable on a phone and easy to scan for a vacancy. Chart is the
 * same data as a line of authority — who reports to whom — which is the question
 * a list cannot answer.
 *
 * The choice is remembered per browser: whichever one somebody uses, they use it
 * every time.
 */
export default function OrgChartView({ rows }: { rows: CallingRecord[] }) {
  const [view, setView] = useState<View>('list')

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'chart' || saved === 'list') setView(saved)
  }, [])

  function choose(next: View) {
    setView(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }

  const roots = useMemo(() => buildOrgTree(rows), [rows])

  const byOrg = useMemo(() => {
    const map = new Map<string, CallingRecord[]>()
    for (const row of [...rows].sort((a, b) => a.sort - b.sort)) {
      const list = map.get(row.org_key)
      if (list) list.push(row)
      else map.set(row.org_key, [row])
    }
    return map
  }, [rows])

  // Top-level orgs in seeded order, each followed by its children. An org with
  // nothing in it is left out rather than shown as an empty box.
  const sections = ORGS.filter((o) => !o.parent).flatMap((parent) =>
    [parent, ...ORGS.filter((o) => o.parent === parent.key)].filter(
      (o) => (byOrg.get(o.key)?.length ?? 0) > 0,
    ),
  )

  return (
    <div className="space-y-4">
      <div className="flex gap-1 text-sm">
        {(['list', 'chart'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => choose(v)}
            className={`rounded-md px-3 py-1.5 font-medium ${
              view === v
                ? 'bg-neutral-900 text-white'
                : 'border border-neutral-300 bg-white text-neutral-700'
            }`}
          >
            {v === 'list' ? 'List' : 'Chart'}
          </button>
        ))}
      </div>

      {view === 'chart' ? (
        <OrgChartGraph roots={roots} />
      ) : (
        <div className="space-y-6">
          {sections.map((section) => {
            const orgRows = byOrg.get(section.key) ?? []
            // Sub-headings from the report, in the order they were printed.
            const units = [...new Set(orgRows.map((r) => r.unit ?? ''))]

            return (
              <section
                key={section.key}
                className={`rounded-lg border border-neutral-200 bg-white p-5 ${
                  section.parent ? 'sm:ml-6' : ''
                }`}
              >
                <h2 className="text-base font-semibold text-neutral-900">
                  {section.parent && (
                    <span className="text-sm font-normal text-neutral-400">
                      {orgLabel(section.parent)} ›{' '}
                    </span>
                  )}
                  {section.label}
                </h2>

                <div className="mt-3 space-y-4">
                  {units.map((unit) => (
                    <div key={unit || '_'}>
                      {unit && (
                        <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                          {unit}
                        </h3>
                      )}
                      <ul className="mt-1 divide-y divide-neutral-100">
                        {orgRows
                          .filter((r) => (r.unit ?? '') === unit)
                          .map((r) => (
                            <li
                              key={r.id}
                              className="flex flex-wrap items-center justify-between gap-x-4 py-1.5 text-sm"
                            >
                              <span className="text-neutral-600">
                                {r.name}
                                {r.is_custom && (
                                  <span className="ml-1 text-xs text-neutral-400">custom</span>
                                )}
                              </span>
                              {/* The avatar sits with the holder, on the right,
                                  so the calling column stays a clean list to scan
                                  for a vacancy. */}
                              <span className="flex items-center gap-2">
                                {r.full_name ? (
                                  <>
                                    <span className="font-medium text-neutral-900">
                                      {r.full_name}
                                    </span>
                                    <Avatar
                                      name={r.full_name}
                                      photoUrl={r.photo_url}
                                      size={28}
                                    />
                                  </>
                                ) : r.printed_name ? (
                                  // On the report, but not yet a person in the ward
                                  // records — usually somebody the directory import
                                  // never covered.
                                  <>
                                    <span
                                      className="font-medium text-neutral-500 italic"
                                      title="From the callings report; no matching person in the ward records"
                                    >
                                      {r.printed_name}
                                    </span>
                                    <Avatar name={r.printed_name} size={28} />
                                  </>
                                ) : (
                                  <>
                                    <span className="text-amber-700">Vacant</span>
                                    <Avatar name={null} size={28} />
                                  </>
                                )}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
