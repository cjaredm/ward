'use client'

import { useState } from 'react'
import LcrSteps from './LcrSteps'
import FilePicker from './FilePicker'

type PlanItem = {
  org: string
  unit: string
  roster: string
  printed: string
  outOfDefaultClass: boolean
  notCounted: boolean
  action: 'add' | 'keep' | 'ambiguous' | 'conflict' | 'unmatched'
  personName: string | null
  how: string | null
  candidates: { id: string; name: string }[]
}

type Roster = {
  org: string
  unit: string
  label: string
  path: string
  printedCount: number | null
  rows: number
  matched: number
}

type Plan = {
  unitName: string | null
  reportDate: string | null
  rosters: Roster[]
  items: PlanItem[]
  removals: { personId: string; personName: string; org: string; unit: string }[]
  skipped: { page: number; text: string; why: string }[]
  counts: Record<string, number>
}

const BUTTON =
  'rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'

const SUMMARY: { key: string; label: string; hint: string }[] = [
  { key: 'add', label: 'New', hint: 'matched a person not on this roster yet' },
  { key: 'keep', label: 'Unchanged', hint: 'already recorded on it' },
  { key: 'remove', label: 'Removed', hint: 'recorded now, not on this report' },
  { key: 'conflict', label: 'Same person twice', hint: 'two names on the report matched one person' },
  { key: 'ambiguous', label: 'Ambiguous', hint: 'more than one person answers to the name' },
  { key: 'unmatched', label: 'No such person', hint: 'nobody in the ward data matches' },
]

function ActionTag({ action }: { action: PlanItem['action'] }) {
  const style: Record<PlanItem['action'], string> = {
    add: 'bg-green-100 text-green-800',
    keep: 'bg-neutral-100 text-neutral-600',
    ambiguous: 'bg-orange-100 text-orange-800',
    conflict: 'bg-orange-100 text-orange-800',
    unmatched: 'bg-red-100 text-red-800',
  }
  const label: Record<PlanItem['action'], string> = {
    add: 'new',
    keep: 'unchanged',
    ambiguous: 'ambiguous',
    conflict: 'same person twice',
    unmatched: 'no match',
  }
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${style[action]}`}>
      {label[action]}
    </span>
  )
}

/**
 * Upload, review, apply — the same shape as the callings tool, and for the same
 * reason: the file is sent twice so the plan the admin approves is parsed from the
 * bytes that get written.
 *
 * The roster table is the part worth reading before applying. LCR prints a count
 * under every roster, so "12 of 12 read, 12 matched" is a claim the report itself
 * can check, and a roster that comes up short is a parse problem rather than a
 * ward that shrank.
 */
export default function RostersImport() {
  const [file, setFile] = useState<File | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [applied, setApplied] = useState(false)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'attention' | 'all'>('attention')

  async function send(apply: boolean) {
    if (!file) return
    setBusy(apply ? 'apply' : 'preview')
    setError(null)
    try {
      const body = new FormData()
      body.set('file', file)
      if (apply) body.set('apply', '1')
      const res = await fetch('/api/admin/import/rosters', { method: 'POST', body })
      const payload = (await res.json().catch(() => null)) as
        | { plan?: Plan; applied?: boolean; error?: string }
        | null
      if (!res.ok || !payload?.plan) {
        setError(payload?.error ?? 'That import did not run.')
        return
      }
      setPlan(payload.plan)
      setApplied(Boolean(payload.applied))
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  const needsAttention = (i: PlanItem) =>
    i.action === 'ambiguous' || i.action === 'conflict' || i.action === 'unmatched'
  const unresolved = plan
    ? plan.counts.ambiguous + plan.counts.conflict + plan.counts.unmatched
    : 0
  const items = plan
    ? filter === 'all'
      ? plan.items
      : plan.items.filter(needsAttention)
    : []

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="flex items-center text-base font-semibold text-neutral-900">
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white">3</span>
          Organization rosters
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Who <em>belongs</em> to each organization and class — the Young Women in Gatherers of
          Light, the children in Valiant 9 — which is what lets the map highlight their homes rather
          than only their leaders&rsquo;.
        </p>

        <LcrSteps
          href="https://lcr.churchofjesuschrist.org/mlt/orgs?lang=eng"
          linkLabel="LCR → Organizations and Callings"
          steps={[
            'Deselect every column option. The roster is all this needs — extra columns only give the parser more to guess at.',
            <>
              Print, and choose <em>Members</em> rather than callings.
            </>,
            'Save as PDF.',
          ]}
          columns="Name"
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <FilePicker
            file={file}
            onPick={(f) => {
              setFile(f)
              setPlan(null)
              setApplied(false)
              setError(null)
            }}
          />
          <button
            type="button"
            onClick={() => send(false)}
            disabled={!file || busy !== null}
            className={`${BUTTON} bg-neutral-900 text-white`}
          >
            {busy === 'preview' ? 'Reading…' : 'Preview changes'}
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
        )}
      </section>

      {plan && (
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-neutral-900">
              {applied ? 'Applied' : 'Proposed changes'}
            </h2>
            <p className="text-sm text-neutral-500">
              {plan.unitName ?? 'Unknown unit'}
              {plan.reportDate ? ` · report dated ${plan.reportDate}` : ''} · {plan.counts.rows}{' '}
              names across {plan.counts.rosters} rosters
            </p>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {SUMMARY.map((s) => (
              <div key={s.key} className="rounded-md border border-neutral-200 px-3 py-2">
                <dt className="text-xs text-neutral-500">{s.label}</dt>
                <dd className="text-lg font-semibold text-neutral-900">{plan.counts[s.key] ?? 0}</dd>
                <p className="text-xs text-neutral-500">{s.hint}</p>
              </div>
            ))}
          </dl>

          {/* Always more than the row count: a Valiant 9 child is written into
              Valiant 9 and into Primary. */}
          <p className="mt-3 text-sm text-neutral-600">
            {plan.counts.memberships} membership row{plan.counts.memberships === 1 ? '' : 's'},
            class roll-ups included.
          </p>

          {!applied && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => send(true)}
                disabled={busy !== null}
                className={`${BUTTON} bg-green-700 text-white`}
              >
                {busy === 'apply' ? 'Applying…' : 'Apply these changes'}
              </button>
              <p className="text-sm text-neutral-500">
                Leaves the memberships that came from callings alone — only rows a previous roster
                import wrote are removed.
              </p>
              {plan.counts.conflict > 0 && (
                <p className="w-full rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-900">
                  {plan.counts.conflict} name{plan.counts.conflict === 1 ? '' : 's'} matched
                  somebody another name on the report already matched — almost always a child named
                  after a parent, with only the parent in the ward data. Those rows are skipped, not
                  guessed at. Add the missing people, then upload this file again.
                </p>
              )}
            </div>
          )}

          {applied && (
            <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              Written. Open the map and pick an organization to highlight.
            </p>
          )}
        </section>
      )}

      {/* The report prints its own counts, so this table is a check on the parse
          rather than a summary of it. */}
      {plan && (
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="text-base font-semibold text-neutral-900">
            Rosters ({plan.rosters.length})
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="text-xs text-neutral-500 uppercase">
                <tr>
                  <th className="py-2 pr-3">Roster</th>
                  <th className="py-2 pr-3">Printed</th>
                  <th className="py-2 pr-3">Read</th>
                  <th className="py-2">Matched to a person</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {plan.rosters.map((r) => {
                  const short = r.printedCount !== null && r.rows !== r.printedCount
                  return (
                    <tr key={`${r.org}|${r.unit}`}>
                      <td className="py-2 pr-3 text-neutral-900">{r.path}</td>
                      <td className="py-2 pr-3 text-neutral-500">{r.printedCount ?? '—'}</td>
                      <td className={`py-2 pr-3 ${short ? 'text-red-700' : 'text-neutral-600'}`}>
                        {r.rows}
                      </td>
                      <td
                        className={`py-2 ${r.matched < r.rows ? 'text-amber-700' : 'text-neutral-600'}`}
                      >
                        {r.matched}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {plan && plan.removals.length > 0 && !applied && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-5">
          <h2 className="text-base font-semibold text-amber-900">
            Will be removed ({plan.removals.length})
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            Recorded from a previous roster import, absent from this one — a child who has aged out
            of a class, or somebody who moved. Removes the membership only, not the person.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-amber-900">
            {plan.removals.map((r) => (
              <li key={`${r.personId}|${r.org}|${r.unit}`}>
                <span className="font-medium">{r.personName}</span> — {r.unit || r.org}
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan && (
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-neutral-900">Names</h2>
            <div className="flex gap-2 text-sm">
              {(['attention', 'all'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-2 py-1 ${
                    filter === f ? 'bg-neutral-900 text-white' : 'text-neutral-600'
                  }`}
                >
                  {f === 'attention' ? `Unresolved ${unresolved}` : `All ${plan.items.length}`}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs text-neutral-500 uppercase">
                <tr>
                  <th className="py-2 pr-3">Roster</th>
                  <th className="py-2 pr-3">Report name</th>
                  <th className="py-2 pr-3">Matched</th>
                  <th className="py-2">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {items.map((item, i) => (
                  <tr key={`${item.roster}-${item.printed}-${i}`} className="align-top">
                    <td className="py-2 pr-3 text-neutral-600">{item.roster}</td>
                    <td className="py-2 pr-3 text-neutral-900">
                      {item.printed}
                      {/* What LCR's gutter marks mean. Shown, not stored: they are
                          facts about a person in one class. */}
                      {item.outOfDefaultClass && (
                        <span
                          className="ml-1 text-xs text-neutral-400"
                          title="Assigned outside the default class for their age"
                        >
                          out of default class
                        </span>
                      )}
                      {item.notCounted && (
                        <span
                          className="ml-1 text-xs text-neutral-400"
                          title="Member of record not counted in unit statistics"
                        >
                          not counted
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-neutral-900">
                      {item.personName ?? '—'}
                      {item.how && item.how !== 'full name' && (
                        <span className="block text-xs text-neutral-400">{item.how}</span>
                      )}
                      {item.candidates.length > 0 && (
                        <span className="block text-xs text-orange-700">
                          {item.candidates.map((c) => c.name).join(', ')}
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <ActionTag action={item.action} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {items.length === 0 && (
            <p className="mt-3 text-sm text-neutral-500">
              {filter === 'attention'
                ? 'Every name on the report matched somebody in the ward.'
                : 'Nothing in this view.'}
            </p>
          )}

          {plan.skipped.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-neutral-600">
                {plan.skipped.length} line(s) could not be read
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-neutral-500">
                {plan.skipped.map((s, i) => (
                  <li key={i}>
                    p{s.page}: {s.text} — {s.why}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  )
}
