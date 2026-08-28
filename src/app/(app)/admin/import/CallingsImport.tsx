'use client'

import { useState } from 'react'
import { orgLabel, orgPath } from '@/lib/orgs'
import LcrSteps from './LcrSteps'
import FilePicker from './FilePicker'

type PlanItem = {
  org: string
  calling: string
  unit: string | null
  printed: string
  isCustom: boolean
  action: 'add' | 'keep' | 'vacancy' | 'ambiguous' | 'unmatched'
  personName: string | null
  how: string | null
  candidates: { id: string; name: string }[]
}

type Plan = {
  unitName: string | null
  reportDate: string | null
  orgs: string[]
  items: PlanItem[]
  releases: { id: string; org: string; calling: string; unit: string | null; personName: string }[]
  skipped: { page: number; text: string; why: string }[]
  counts: Record<string, number>
}

const BUTTON =
  'rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'

/** The four numbers that decide whether Apply is safe, in the order they matter. */
const SUMMARY: { key: string; label: string; hint: string }[] = [
  { key: 'add', label: 'New callings', hint: 'matched a person who does not hold it yet' },
  { key: 'keep', label: 'Unchanged', hint: 'already recorded exactly as printed' },
  { key: 'release', label: 'Released', hint: 'held now, not on this report' },
  { key: 'vacancy', label: 'Vacant', hint: 'printed as Calling Vacant' },
  { key: 'ambiguous', label: 'Ambiguous', hint: 'more than one person answers to the name' },
  { key: 'unmatched', label: 'No such person', hint: 'nobody in the ward data matches' },
]

function ActionTag({ action }: { action: PlanItem['action'] }) {
  const style: Record<PlanItem['action'], string> = {
    add: 'bg-green-100 text-green-800',
    keep: 'bg-neutral-100 text-neutral-600',
    vacancy: 'bg-amber-100 text-amber-800',
    ambiguous: 'bg-orange-100 text-orange-800',
    unmatched: 'bg-red-100 text-red-800',
  }
  const label: Record<PlanItem['action'], string> = {
    add: 'new',
    keep: 'unchanged',
    vacancy: 'vacant',
    ambiguous: 'ambiguous',
    unmatched: 'no match',
  }
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${style[action]}`}>
      {label[action]}
    </span>
  )
}

/**
 * Upload, review, apply.
 *
 * The file is sent twice on purpose — once to preview, once to write — so the
 * plan the admin approves is parsed from the same bytes that get applied and
 * nothing waits on the server in between.
 */
export default function CallingsImport() {
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
      const res = await fetch('/api/admin/import/callings', { method: 'POST', body })
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

  const needsAttention = (i: PlanItem) => i.action === 'ambiguous' || i.action === 'unmatched'
  const items = plan
    ? filter === 'all'
      ? plan.items
      : plan.items.filter((i) => needsAttention(i) || i.action === 'add')
    : []

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="flex items-center text-base font-semibold text-neutral-900">
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white">2</span>
          Callings report
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Who holds which calling. Upload it here to see what would change before anything is
          written.
        </p>

        <LcrSteps
          href="https://lcr.churchofjesuschrist.org/mlt/orgs?lang=eng"
          linkLabel="LCR → Organizations and Callings"
          steps={[
            'Print, and leave the report as callings — do not switch it to members.',
            'Save as PDF.',
          ]}
          columns="Calling / Name"
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
              {plan.reportDate ? ` · report dated ${plan.reportDate}` : ''} ·{' '}
              {plan.counts.rows} rows across {plan.orgs.length} organizations
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

          {plan.counts.newMemberships > 0 && (
            <p className="mt-3 text-sm text-neutral-600">
              {plan.counts.newMemberships} new organization membership
              {plan.counts.newMemberships === 1 ? '' : 's'} will be recorded from these callings.
            </p>
          )}

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
                Releases {plan.counts.release} calling{plan.counts.release === 1 ? '' : 's'} that
                this report no longer lists.
              </p>
            </div>
          )}

          {applied && (
            <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              Written. Open the org chart to check it.
            </p>
          )}
        </section>
      )}

      {plan && plan.releases.length > 0 && !applied && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-5">
          <h2 className="text-base font-semibold text-amber-900">
            Will be released ({plan.releases.length})
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            Held now, absent from this report. A release keeps the history — it does not delete the
            person.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-amber-900">
            {plan.releases.map((r) => (
              <li key={r.id}>
                <span className="font-medium">{r.personName}</span> — {r.calling}
                {r.unit ? ` (${r.unit})` : ''} · {orgLabel(r.org)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan && (
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-neutral-900">Rows</h2>
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
                  {f === 'attention' ? 'New and unresolved' : `All ${plan.items.length}`}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs text-neutral-500 uppercase">
                <tr>
                  <th className="py-2 pr-3">Organization</th>
                  <th className="py-2 pr-3">Calling</th>
                  <th className="py-2 pr-3">Report name</th>
                  <th className="py-2 pr-3">Matched</th>
                  <th className="py-2">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {items.map((item, i) => (
                  <tr key={`${item.org}-${item.calling}-${i}`} className="align-top">
                    <td className="py-2 pr-3 text-neutral-600">
                      {orgPath(item.org)}
                      {item.unit && <span className="block text-xs text-neutral-400">{item.unit}</span>}
                    </td>
                    <td className="py-2 pr-3 text-neutral-900">
                      {item.calling}
                      {item.isCustom && <span className="ml-1 text-xs text-neutral-400">custom</span>}
                    </td>
                    <td className="py-2 pr-3 text-neutral-600">{item.printed}</td>
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
            <p className="mt-3 text-sm text-neutral-500">Nothing in this view.</p>
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
