'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  HOUSEHOLD_STATUSES,
  STATUS_LABELS,
  type Household,
  type HouseholdStatus,
  type ParcelDetail,
  type Person,
} from '@/lib/types'

type SaveState = { status: 'idle' | 'saving' | 'saved' | 'error'; at?: number; message?: string }

function relativeTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

export default function ParcelPanel({
  parcelId,
  actorName,
  onClose,
  onChanged,
}: {
  parcelId: string
  actorName: string
  onClose: () => void
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<ParcelDetail | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [save, setSave] = useState<SaveState>({ status: 'idle' })
  const [, forceTick] = useState(0)

  const load = useCallback(async () => {
    const res = await fetch(`/api/parcels/${encodeURIComponent(parcelId)}`)
    if (!res.ok) return
    const body = (await res.json()) as ParcelDetail
    setDetail(body)
    setActiveIdx((i) => Math.min(i, Math.max(0, body.households.length - 1)))
  }, [parcelId])

  useEffect(() => {
    setDetail(null)
    setSave({ status: 'idle' })
    void load()
  }, [load])

  // Keep "Saved · 2m ago" honest without re-fetching.
  useEffect(() => {
    if (save.status !== 'saved') return
    const t = setInterval(() => forceTick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [save.status])

  const household = detail?.households[activeIdx] ?? null

  /**
   * Optimistic: the local edit is already applied by the caller, so a failure
   * surfaces as an error banner rather than silently reverting the user's typing.
   * Ward members use this on a phone in a parking lot; losing input to a dropped
   * request is the failure mode that matters.
   */
  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      setSave({ status: 'saving' })
      try {
        const res = await fetch(`/api/households/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          setSave({ status: 'error', message: 'Not saved — check your connection and press Save.' })
          return
        }
        setSave({ status: 'saved', at: Date.now() })
        onChanged()
      } catch {
        setSave({ status: 'error', message: 'Not saved — check your connection and press Save.' })
      }
    },
    [onChanged],
  )

  const updateLocal = useCallback((patchFields: Partial<Household>) => {
    setDetail((d) => {
      if (!d) return d
      const households = d.households.slice()
      households[activeIdxRef.current] = { ...households[activeIdxRef.current], ...patchFields }
      return { ...d, households }
    })
  }, [])

  const activeIdxRef = useRef(activeIdx)
  activeIdxRef.current = activeIdx

  async function addHousehold() {
    const res = await fetch('/api/households', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parcel_id: parcelId, family_name: 'New household' }),
    })
    if (!res.ok) {
      setSave({ status: 'error', message: 'Could not add household.' })
      return
    }
    await load()
    setActiveIdx(detail?.households.length ?? 0)
    onChanged()
  }

  async function deleteHousehold(id: string, name: string) {
    if (
      !confirm(
        `Delete "${name}"? This permanently removes the names, phone numbers and emails on this household.`,
      )
    )
      return
    const res = await fetch(`/api/households/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      setSave({ status: 'error', message: 'Could not delete household.' })
      return
    }
    setActiveIdx(0)
    await load()
    onChanged()
  }

  const parcel = detail?.parcel

  return (
    <aside
      className="absolute inset-x-0 bottom-0 z-20 flex max-h-[70dvh] flex-col rounded-t-2xl bg-white shadow-2xl ring-1 ring-black/10 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[26rem] sm:max-h-none sm:rounded-none sm:rounded-l-2xl"
      aria-label="Parcel details"
    >
      {/* County data — read-only, visually distinct from everything editable below. */}
      <header className="shrink-0 border-b border-neutral-200 bg-neutral-100 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-neutral-900">
              {parcel?.address ?? (detail ? 'No address on file' : 'Loading…')}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-neutral-500">{parcelId}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded p-1.5 text-neutral-500 hover:bg-neutral-200"
          >
            ✕
          </button>
        </div>
        <p className="mt-2 text-[11px] text-neutral-500">
          Washington County record · not editable
          {parcel?.coparcel_url && (
            <>
              {' · '}
              <a
                href={parcel.coparcel_url}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2"
              >
                County viewer
              </a>
            </>
          )}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {detail && detail.households.length === 0 && (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-neutral-600">No household recorded on this parcel.</p>
            <button
              onClick={addHousehold}
              className="mt-3 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white"
            >
              Add household
            </button>
          </div>
        )}

        {detail && detail.households.length > 1 && (
          <div className="flex gap-1 overflow-x-auto border-b border-neutral-200 px-2 py-2">
            {detail.households.map((h, i) => (
              <button
                key={h.id}
                onClick={() => setActiveIdx(i)}
                className={`shrink-0 rounded-md px-2.5 py-1 text-xs ${
                  i === activeIdx ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-700'
                }`}
              >
                {h.family_name || 'Untitled'}
              </button>
            ))}
          </div>
        )}

        {household && (
          <HouseholdForm
            key={household.id}
            household={household}
            onLocalChange={updateLocal}
            onCommit={(body) => patch(household.id, body)}
            onDelete={() => deleteHousehold(household.id, household.family_name)}
            onAddHousehold={addHousehold}
          />
        )}
      </div>

      <footer className="shrink-0 border-t border-neutral-200 px-4 py-2 text-xs">
        {save.status === 'error' ? (
          <span className="text-red-600">{save.message}</span>
        ) : save.status === 'saving' ? (
          <span className="text-neutral-500">Saving…</span>
        ) : save.status === 'saved' && save.at ? (
          <span className="text-neutral-500">
            Saved · {relativeTime(save.at)} by {household?.updated_by ?? actorName}
          </span>
        ) : household ? (
          <span className="text-neutral-400">
            Last edited{household.updated_by ? ` by ${household.updated_by}` : ''}
          </span>
        ) : null}
      </footer>
    </aside>
  )
}

function HouseholdForm({
  household,
  onLocalChange,
  onCommit,
  onDelete,
  onAddHousehold,
}: {
  household: Household
  onLocalChange: (p: Partial<Household>) => void
  onCommit: (body: Record<string, unknown>) => void
  onDelete: () => void
  onAddHousehold: () => void
}) {
  const [people, setPeople] = useState<Person[]>(household.people)

  function commitPeople(next: Person[]) {
    setPeople(next)
    onCommit({
      people: next.map((p) => ({
        ...(p.id.startsWith('new:') ? {} : { id: p.id }),
        full_name: p.full_name,
        role: p.role,
        phone: p.phone,
        email: p.email,
      })),
    })
  }

  const field =
    'mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900'
  const label = 'block text-xs font-medium text-neutral-700'

  return (
    <div className="space-y-4 px-4 py-4">
      <div>
        <label className={label} htmlFor="family_name">
          Family name
        </label>
        <input
          id="family_name"
          className={field}
          defaultValue={household.family_name}
          // Autosave on blur, plus the explicit Save button below.
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v && v !== household.family_name) {
              onLocalChange({ family_name: v })
              onCommit({ family_name: v })
            }
          }}
        />
      </div>

      <div>
        <label className={label} htmlFor="status">
          Status
        </label>
        <select
          id="status"
          className={field}
          value={household.status}
          onChange={(e) => {
            const v = e.target.value as HouseholdStatus
            onLocalChange({ status: v })
            onCommit({ status: v })
          }}
        >
          {HOUSEHOLD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="district">
            Ministering district
          </label>
          <input
            id="district"
            className={field}
            defaultValue={household.ministering_district ?? ''}
            onBlur={(e) => onCommit({ ministering_district: e.target.value.trim() || null })}
          />
        </div>
        <div>
          <label className={label} htmlFor="group">
            Organization
          </label>
          <input
            id="group"
            className={field}
            placeholder="EQ / RS"
            defaultValue={household.organization_group ?? ''}
            onBlur={(e) => onCommit({ organization_group: e.target.value.trim() || null })}
          />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="companionship">
          Ministering companionship
        </label>
        <input
          id="companionship"
          className={field}
          defaultValue={household.ministering_companionship ?? ''}
          onBlur={(e) => onCommit({ ministering_companionship: e.target.value.trim() || null })}
        />
      </div>

      <div>
        <label className={label} htmlFor="notes">
          Notes
        </label>
        <textarea
          id="notes"
          rows={3}
          className={field}
          defaultValue={household.notes ?? ''}
          onBlur={(e) => onCommit({ notes: e.target.value.trim() || null })}
        />
      </div>

      <section>
        <h3 className="text-xs font-semibold text-neutral-900">People</h3>
        <ul className="mt-2 space-y-3">
          {people.map((p, i) => (
            <li key={p.id} className="rounded-md border border-neutral-200 p-2.5">
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
                  placeholder="Full name"
                  defaultValue={p.full_name}
                  onBlur={(e) => {
                    const next = people.slice()
                    next[i] = { ...p, full_name: e.target.value.trim() }
                    if (next[i].full_name) commitPeople(next)
                  }}
                />
                <input
                  className="w-24 rounded border border-neutral-300 px-2 py-1.5 text-sm"
                  placeholder="Role"
                  defaultValue={p.role ?? ''}
                  onBlur={(e) => {
                    const next = people.slice()
                    next[i] = { ...p, role: e.target.value.trim() || null }
                    commitPeople(next)
                  }}
                />
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
                  placeholder="Phone"
                  type="tel"
                  inputMode="tel"
                  defaultValue={p.phone ?? ''}
                  onBlur={(e) => {
                    const next = people.slice()
                    next[i] = { ...p, phone: e.target.value.trim() || null }
                    commitPeople(next)
                  }}
                />
                <input
                  className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
                  placeholder="Email"
                  type="email"
                  inputMode="email"
                  defaultValue={p.email ?? ''}
                  onBlur={(e) => {
                    const next = people.slice()
                    next[i] = { ...p, email: e.target.value.trim() || null }
                    commitPeople(next)
                  }}
                />
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs">
                {p.phone && (
                  <a href={`tel:${p.phone}`} className="text-blue-700 underline underline-offset-2">
                    Call
                  </a>
                )}
                {p.email && (
                  <a
                    href={`mailto:${p.email}`}
                    className="text-blue-700 underline underline-offset-2"
                  >
                    Email
                  </a>
                )}
                <button
                  onClick={() => commitPeople(people.filter((_, j) => j !== i))}
                  className="ml-auto text-neutral-500 underline underline-offset-2"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        <button
          onClick={() =>
            setPeople([
              ...people,
              {
                id: `new:${people.length}:${Date.now()}`,
                full_name: '',
                role: null,
                phone: null,
                email: null,
                sort_order: people.length,
              },
            ])
          }
          className="mt-2 rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-800"
        >
          Add person
        </button>
      </section>

      <div className="flex items-center gap-2 border-t border-neutral-200 pt-4">
        <button
          onClick={() =>
            onCommit({
              family_name: household.family_name,
              status: household.status,
              people: people
                .filter((p) => p.full_name.trim())
                .map((p) => ({
                  ...(p.id.startsWith('new:') ? {} : { id: p.id }),
                  full_name: p.full_name,
                  role: p.role,
                  phone: p.phone,
                  email: p.email,
                })),
            })
          }
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white"
        >
          Save
        </button>
        <button
          onClick={onAddHousehold}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-800"
        >
          Add household
        </button>
        <button
          onClick={onDelete}
          className="ml-auto rounded-md px-3 py-2 text-sm text-red-700 underline underline-offset-2"
        >
          Delete this household
        </button>
      </div>
    </div>
  )
}
