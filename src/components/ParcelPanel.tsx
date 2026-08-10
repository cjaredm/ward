'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  HOUSEHOLD_STATUSES,
  PARCEL_USES,
  STATUS_LABELS,
  USE_LABELS,
  type Household,
  type HouseholdStatus,
  type ParcelDetail,
  type ParcelUse,
  type Person,
} from '@/lib/types'

/** What the panel is showing: a county parcel, or a household pinned to a point. */
export type PanelTarget =
  | { kind: 'parcel'; parcelId: string }
  | { kind: 'pin'; householdId: string }

type SaveState = { status: 'idle' | 'saving' | 'saved' | 'error'; at?: number; message?: string }

function relativeTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

const field =
  'mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900'
const labelCls = 'block text-xs font-medium text-neutral-700'

export default function ParcelPanel({
  target,
  actorName,
  onClose,
  onChanged,
}: {
  target: PanelTarget
  actorName: string
  onClose: () => void
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<ParcelDetail | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [save, setSave] = useState<SaveState>({ status: 'idle' })
  const [, forceTick] = useState(0)

  const url =
    target.kind === 'parcel'
      ? `/api/parcels/${encodeURIComponent(target.parcelId)}`
      : `/api/households/${encodeURIComponent(target.householdId)}`

  const load = useCallback(async () => {
    const res = await fetch(url)
    if (!res.ok) return
    const body = (await res.json()) as ParcelDetail
    setDetail(body)
    setActiveIdx((i) => Math.min(i, Math.max(0, body.households.length - 1)))
  }, [url])

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

  const activeIdxRef = useRef(activeIdx)
  activeIdxRef.current = activeIdx

  const household = detail?.households[activeIdx] ?? null
  const parcel = detail?.parcel ?? null

  /**
   * Optimistic: the local edit is already applied by the caller, so a failure
   * surfaces as an error banner rather than silently reverting the user's typing.
   * Ward members use this on a phone in a parking lot; losing input to a dropped
   * request is the failure mode that matters.
   */
  const patchHousehold = useCallback(
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

  const patchParcel = useCallback(
    async (body: Record<string, unknown>) => {
      if (target.kind !== 'parcel') return
      setSave({ status: 'saving' })
      try {
        const res = await fetch(`/api/parcels/${encodeURIComponent(target.parcelId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          setSave({ status: 'error', message: 'Not saved — check your connection.' })
          return
        }
        setSave({ status: 'saved', at: Date.now() })
        await load()
        onChanged()
      } catch {
        setSave({ status: 'error', message: 'Not saved — check your connection.' })
      }
    },
    [target, load, onChanged],
  )

  const updateLocal = useCallback((patchFields: Partial<Household>) => {
    setDetail((d) => {
      if (!d) return d
      const households = d.households.slice()
      households[activeIdxRef.current] = { ...households[activeIdxRef.current], ...patchFields }
      return { ...d, households }
    })
  }, [])

  async function addHousehold() {
    if (target.kind !== 'parcel') return
    const res = await fetch('/api/households', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parcel_id: target.parcelId, family_name: 'New household' }),
    })
    if (!res.ok) {
      setSave({ status: 'error', message: 'Could not add household.' })
      return
    }
    const next = detail?.households.length ?? 0
    await load()
    setActiveIdx(next)
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
    onChanged()
    // A pinned household IS the thing the panel is showing; once it is gone
    // there is nothing left to display.
    if (target.kind === 'pin') {
      onClose()
      return
    }
    setActiveIdx(0)
    await load()
  }

  const isBusiness = parcel?.use_type === 'business'
  const headerTitle =
    target.kind === 'pin'
      ? (household?.address ?? household?.family_name ?? 'Pinned home')
      : (parcel?.address ?? (detail ? 'No address on file' : 'Loading…'))

  return (
    <aside
      className="absolute inset-x-0 bottom-0 z-20 flex max-h-[70dvh] flex-col rounded-t-2xl bg-white shadow-2xl ring-1 ring-black/10 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[26rem] sm:max-h-none sm:rounded-none sm:rounded-l-2xl"
      aria-label="Parcel details"
    >
      {/* County data — read-only, visually distinct from everything editable below. */}
      <header className="shrink-0 border-b border-neutral-200 bg-neutral-100 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-neutral-900">{headerTitle}</p>
            <p className="mt-0.5 font-mono text-[11px] text-neutral-500">
              {target.kind === 'parcel' ? target.parcelId : 'Dropped pin · no county parcel'}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded p-1.5 text-neutral-500 hover:bg-neutral-200"
          >
            ✕
          </button>
        </div>
        {target.kind === 'parcel' && (
          <p className="mt-2 text-[11px] text-neutral-500">
            {parcel?.source === 'manual'
              ? 'Hand-drawn outline · not a county record'
              : 'Washington County record · not editable'}
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
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* What the property is used for. Ward-set, survives the monthly import. */}
        {target.kind === 'parcel' && parcel && (
          <section className="border-b border-neutral-200 px-4 py-3">
            <label className={labelCls} htmlFor="use_type">
              Property type
            </label>
            <select
              id="use_type"
              className={field}
              value={parcel.use_type}
              onChange={(e) => patchParcel({ use_type: e.target.value as ParcelUse })}
            >
              {PARCEL_USES.map((u) => (
                <option key={u} value={u}>
                  {USE_LABELS[u]}
                </option>
              ))}
            </select>

            {parcel.source === 'manual' && (
              <button
                onClick={async () => {
                  if (!confirm('Delete this hand-drawn parcel? The outline is removed from the map.'))
                    return
                  const res = await fetch(`/api/parcels/${encodeURIComponent(parcel.parcel_id)}`, {
                    method: 'DELETE',
                  })
                  if (!res.ok) {
                    const body = (await res.json().catch(() => null)) as { error?: string } | null
                    setSave({ status: 'error', message: body?.error ?? 'Could not delete.' })
                    return
                  }
                  onChanged()
                  onClose()
                }}
                className="mt-2 text-xs text-red-700 underline underline-offset-2"
              >
                Delete this drawn parcel
              </button>
            )}

            {isBusiness && (
              <div className="mt-3">
                <label className={labelCls} htmlFor="business_name">
                  Business name
                </label>
                <input
                  id="business_name"
                  className={field}
                  placeholder="e.g. Cloud's Moving & Storage"
                  defaultValue={parcel.business_name ?? ''}
                  onBlur={(e) => patchParcel({ business_name: e.target.value.trim() || null })}
                />
                <p className="mt-1 text-[11px] text-neutral-500">
                  Shown on the map instead of a family name. Businesses are not counted as homes.
                </p>
              </div>
            )}
          </section>
        )}

        {detail && detail.households.length === 0 && (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-neutral-600">
              {isBusiness
                ? 'Marked as a business — nobody lives here.'
                : 'No household recorded on this parcel.'}
            </p>
            {/* Nothing to add on a business: switch the property type back to Home first. */}
            {!isBusiness && (
              <button
                onClick={addHousehold}
                className="mt-3 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white"
              >
                Add household
              </button>
            )}
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
            showAddress={target.kind === 'pin'}
            // A business holds no households, so offering a second one is noise.
            // Reachable when a parcel is marked business after a household exists.
            canAddHousehold={target.kind === 'parcel' && !isBusiness}
            onLocalChange={updateLocal}
            onCommit={(body) => patchHousehold(household.id, body)}
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
  showAddress,
  canAddHousehold,
  onLocalChange,
  onCommit,
  onDelete,
  onAddHousehold,
}: {
  household: Household
  showAddress: boolean
  canAddHousehold: boolean
  onLocalChange: (p: Partial<Household>) => void
  onCommit: (body: Record<string, unknown>) => void
  onDelete: () => void
  onAddHousehold: () => void
}) {
  const [people, setPeople] = useState<Person[]>(household.people)

  function commitPeople(next: Person[]) {
    setPeople(next)
    onCommit({
      people: next
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

  return (
    <div className="space-y-4 px-4 py-4">
      <div>
        <label className={labelCls} htmlFor="family_name">
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

      {/* Only pinned households need a typed address; parcels carry the county one. */}
      {showAddress && (
        <div>
          <label className={labelCls} htmlFor="address">
            Address
          </label>
          <input
            id="address"
            className={field}
            placeholder="Street address"
            defaultValue={household.address ?? ''}
            onBlur={(e) => onCommit({ address: e.target.value.trim() || null })}
          />
        </div>
      )}

      <div>
        <label className={labelCls} htmlFor="status">
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

      <div>
        <label className={labelCls} htmlFor="notes">
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
        {canAddHousehold && (
          <button
            onClick={onAddHousehold}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-800"
          >
            Add household
          </button>
        )}
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
