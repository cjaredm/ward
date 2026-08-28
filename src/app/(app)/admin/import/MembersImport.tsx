'use client'

import { useState } from 'react'
import LcrSteps from './LcrSteps'
import FilePicker from './FilePicker'

type Plan = {
  unitName: string | null
  reportDate: string | null
  printedCount: number | null
  newHouseholds: {
    id: string
    family: string
    address: string | null
    parcelId: string | null
    placement: string
    people: { id: string; name: string }[]
  }[]
  addPeople: { id: string; household: string; name: string }[]
  movers: { name: string; household: string; from: string | null; to: string }[]
  absent: { name: string; household: string }[]
  skipped: { page: number; text: string; why: string }[]
  counts: Record<string, number>
}

const BUTTON =
  'rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'

const SUMMARY: { key: string; label: string; hint: string }[] = [
  { key: 'members', label: 'On the report', hint: 'members read out of the PDF' },
  { key: 'known', label: 'Already known', hint: 'matched somebody in the ward records' },
  { key: 'newPeople', label: 'New people', hint: 'will be added' },
  { key: 'newHouseholds', label: 'New households', hint: 'homes not on the map yet' },
  { key: 'movers', label: 'Address differs', hint: 'listed only — nothing is moved' },
  { key: 'absent', label: 'Not on the report', hint: 'listed only — nothing is deleted' },
]

/**
 * Upload, review, apply — the member list half.
 *
 * Deliberately additive: the preview lists movers and people who have dropped
 * off the report, but Apply only ever creates households and people. Moving a
 * family is a decision about which house on the map they now live in, and that
 * belongs on the map.
 */
export default function MembersImport() {
  const [file, setFile] = useState<File | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [applied, setApplied] = useState(false)
  const [linked, setLinked] = useState(0)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState<'new' | 'movers' | 'absent'>('new')

  async function send(apply: boolean) {
    if (!file) return
    setBusy(apply ? 'apply' : 'preview')
    setError(null)
    try {
      const body = new FormData()
      body.set('file', file)
      if (apply) body.set('apply', '1')
      const res = await fetch('/api/admin/import/members', { method: 'POST', body })
      const payload = (await res.json().catch(() => null)) as {
        plan?: Plan
        applied?: boolean
        linkedCallings?: number
        error?: string
      } | null
      if (!res.ok || !payload?.plan) {
        setError(payload?.error ?? 'That import did not run.')
        return
      }
      setPlan(payload.plan)
      setApplied(Boolean(payload.applied))
      setLinked(payload.linkedCallings ?? 0)
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  const shortfall = plan?.printedCount != null ? plan.printedCount - plan.counts.members : null

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="flex items-center text-base font-semibold text-neutral-900">
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white">1</span>
          Member list
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Names and addresses. Households and people are only ever added — nothing is moved, edited
          or deleted.
        </p>

        <LcrSteps
          href="https://lcr.churchofjesuschrist.org/mlt/records/member-list?lang=eng"
          linkLabel="LCR → Member List"
          steps={[
            'Deselect every column. The address comes through on its own; the rest only crowds the page and pushes the address column around.',
            'Print → save as PDF.',
          ]}
          columns="Name / Address"
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
              {plan.reportDate ? ` · report dated ${plan.reportDate}` : ''}
            </p>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {SUMMARY.map((s) => (
              <div key={s.key} className="rounded-md border border-neutral-200 px-3 py-2">
                <dt className="text-xs text-neutral-500">{s.label}</dt>
                <dd className="text-lg font-semibold text-neutral-900">
                  {plan.counts[s.key] ?? 0}
                </dd>
                <p className="text-xs text-neutral-500">{s.hint}</p>
              </div>
            ))}
          </dl>

          {shortfall != null && shortfall !== 0 && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              The report says it holds {plan.printedCount} members and {plan.counts.members} were
              read.{' '}
              {shortfall > 0
                ? `${shortfall} row(s) could not be read.`
                : 'More rows were read than the report counts.'}
            </p>
          )}

          {plan.counts.parked > 0 && (
            <p className="mt-3 text-sm text-neutral-600">
              {plan.counts.parked} household(s) have an address the county has no parcel for. They
              land in a cluster at the centre of the ward — open the map and drag each onto its
              house.
            </p>
          )}

          {!applied && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => send(true)}
                disabled={busy !== null || plan.counts.newPeople === 0}
                className={`${BUTTON} bg-green-700 text-white`}
              >
                {busy === 'apply' ? 'Applying…' : `Add ${plan.counts.newPeople} people`}
              </button>
              <p className="text-sm text-neutral-500">
                Creates {plan.counts.newHouseholds} household(s). Nothing existing is changed.
              </p>
            </div>
          )}

          {applied && (
            <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              Written.
              {linked > 0
                ? ` ${linked} calling(s) that had nobody attached now point at a real person.`
                : ''}
            </p>
          )}
        </section>
      )}

      {plan && (
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-neutral-900">Detail</h2>
            <div className="flex gap-2 text-sm">
              {(
                [
                  ['new', `New (${plan.newHouseholds.length + plan.addPeople.length})`],
                  ['movers', `Address differs (${plan.movers.length})`],
                  ['absent', `Not on the report (${plan.absent.length})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setShow(key)}
                  className={`rounded-md px-2 py-1 ${
                    show === key ? 'bg-neutral-900 text-white' : 'text-neutral-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {show === 'new' && (
            <div className="mt-3 space-y-4">
              {plan.newHouseholds.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                    New households
                  </h3>
                  <ul className="mt-1 divide-y divide-neutral-100 text-sm">
                    {plan.newHouseholds.map((h) => (
                      <li key={h.id} className="py-2">
                        <span className="font-medium text-neutral-900">{h.family}</span>
                        <span className="text-neutral-600"> — {h.address ?? '(no address)'}</span>
                        <span className="block text-xs text-neutral-500">
                          {h.parcelId
                            ? `parcel ${h.parcelId} · ${h.placement}`
                            : `pin · ${h.placement}`}
                          {' · '}
                          {h.people.map((p) => p.name).join(', ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.addPeople.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                    People joining a household already on the map
                  </h3>
                  <ul className="mt-1 divide-y divide-neutral-100 text-sm">
                    {plan.addPeople.map((p) => (
                      <li key={p.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                        <span className="font-medium text-neutral-900">{p.name}</span>
                        <span className="text-neutral-500">{p.household}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.newHouseholds.length + plan.addPeople.length === 0 && (
                <p className="text-sm text-neutral-500">
                  Nothing new — every member on the report is already in the ward records.
                </p>
              )}
            </div>
          )}

          {show === 'movers' && (
            <ul className="mt-3 divide-y divide-neutral-100 text-sm">
              {plan.movers.map((m, i) => (
                <li key={`${m.name}-${i}`} className="py-1.5">
                  <span className="font-medium text-neutral-900">{m.name}</span>
                  <span className="block text-xs text-neutral-500">
                    on the map at {m.from ?? '(no address)'} · report says {m.to}
                  </span>
                </li>
              ))}
              {plan.movers.length === 0 && (
                <li className="py-1.5 text-neutral-500">
                  Every address on the report matches the map.
                </li>
              )}
            </ul>
          )}

          {show === 'absent' && (
            <ul className="mt-3 divide-y divide-neutral-100 text-sm">
              {plan.absent.map((a, i) => (
                <li key={`${a.name}-${i}`} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <span className="text-neutral-900">{a.name}</span>
                  <span className="text-neutral-500">{a.household}</span>
                </li>
              ))}
              {plan.absent.length === 0 && (
                <li className="py-1.5 text-neutral-500">Everybody on the map is on the report.</li>
              )}
            </ul>
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
