'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  HOUSEHOLD_STATUSES,
  PARCEL_USES,
  STATUS_LABELS,
  USE_LABELS,
  categoryLabel,
  type Business,
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

/** 16px on a phone: anything smaller is hard to read at arm's length outdoors. */
const field =
  'mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-2.5 text-base text-neutral-900 outline-none focus:border-neutral-900 sm:py-2 sm:text-sm'
const labelCls = 'block text-xs font-medium text-neutral-700'
/** 44px minimum hit area on touch, compact again at `sm`. */
const TAP = 'min-h-11 sm:min-h-0'

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
  /**
   * True while this is rendered as a bottom sheet rather than a side panel.
   *
   * The sheet covers the map, so a save there ends with the panel out of the
   * way; the desktop panel sits beside the map and has no reason to close.
   */
  const [isSheet, setIsSheet] = useState(false)

  useEffect(() => {
    // Matches the `sm:` breakpoint the layout below switches on.
    const mq = window.matchMedia('(max-width: 639px)')
    const sync = () => setIsSheet(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

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
    async (id: string, body: Record<string, unknown>): Promise<boolean> => {
      setSave({ status: 'saving' })
      try {
        const res = await fetch(`/api/households/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          setSave({ status: 'error', message: 'Not saved — check your connection and press Save.' })
          return false
        }
        setSave({ status: 'saved', at: Date.now() })
        onChanged()
        return true
      } catch {
        setSave({ status: 'error', message: 'Not saved — check your connection and press Save.' })
        return false
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

  /**
   * Business tenants. Same shape as households — many rows per parcel, because a
   * single industrial unit here holds up to six of them — but a much smaller
   * record, so they render as an inline list rather than tabbed forms.
   *
   * Every write re-loads the panel and tells the map: the first tenant is the
   * label the parcel is drawn with.
   */
  const addBusiness = useCallback(async () => {
    if (target.kind !== 'parcel') return
    setSave({ status: 'saving' })
    const res = await fetch('/api/businesses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parcel_id: target.parcelId, name: 'New business' }),
    })
    if (!res.ok) {
      setSave({ status: 'error', message: 'Could not add business.' })
      return
    }
    setSave({ status: 'saved', at: Date.now() })
    await load()
    onChanged()
  }, [target, load, onChanged])

  const patchBusiness = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      setSave({ status: 'saving' })
      try {
        const res = await fetch(`/api/businesses/${id}`, {
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
    [load, onChanged],
  )

  const deleteBusiness = useCallback(
    async (id: string, name: string) => {
      if (!confirm(`Remove "${name}" from this property?`)) return
      const res = await fetch(`/api/businesses/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        setSave({ status: 'error', message: 'Could not remove business.' })
        return
      }
      await load()
      onChanged()
    },
    [load, onChanged],
  )

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
      className="absolute inset-x-0 bottom-0 z-20 flex max-h-[75dvh] flex-col rounded-t-2xl bg-white shadow-2xl ring-1 ring-black/10 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[26rem] sm:max-h-none sm:rounded-none sm:rounded-l-2xl"
      aria-label="Parcel details"
    >
      {/* County data — read-only, visually distinct from everything editable below. */}
      <header className="shrink-0 rounded-t-2xl border-b border-neutral-200 bg-neutral-100 px-4 pb-3 pt-2 sm:rounded-none sm:pt-3">
        {/* Reads as a sheet you can dismiss, which is what the ✕ does. */}
        <div
          aria-hidden
          className="mx-auto mb-2 h-1 w-10 rounded-full bg-neutral-300 sm:hidden"
        />
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
            className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-200 sm:h-8 sm:w-8"
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

      {/* overscroll-contain: without it, flicking past the end of the form keeps
          going and pans the map underneath. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
                className={`mt-2 px-1 text-xs text-red-700 underline underline-offset-2 ${TAP}`}
              >
                Delete this drawn parcel
              </button>
            )}

            {isBusiness && (
              <BusinessList
                businesses={detail?.businesses ?? []}
                onAdd={addBusiness}
                onPatch={patchBusiness}
                onDelete={deleteBusiness}
              />
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
                className={`mt-3 rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white ${TAP}`}
              >
                Add household
              </button>
            )}
          </div>
        )}

        {detail && detail.households.length > 1 && (
          <div className="flex gap-1 overflow-x-auto overscroll-x-contain border-b border-neutral-200 px-2 py-2">
            {detail.households.map((h, i) => (
              <button
                key={h.id}
                onClick={() => setActiveIdx(i)}
                className={`shrink-0 rounded-md px-3 py-2 text-xs sm:py-1 ${
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
            saving={save.status === 'saving'}
            onLocalChange={updateLocal}
            onCommit={(body) => patchHousehold(household.id, body)}
            onSaved={() => {
              if (isSheet) onClose()
            }}
            onDelete={() => deleteHousehold(household.id, household.family_name)}
            onAddHousehold={addHousehold}
          />
        )}
      </div>

      <footer
        className="shrink-0 border-t border-neutral-200 px-4 py-2 text-xs"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
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

/**
 * The tenants of a business parcel.
 *
 * Names are uncontrolled with a blur-to-save, matching the rest of the panel:
 * on a phone in a parking lot, an autosave per keystroke is a dropped request
 * per keystroke.
 */
function BusinessList({
  businesses,
  onAdd,
  onPatch,
  onDelete,
}: {
  businesses: Business[]
  onAdd: () => void
  onPatch: (id: string, body: Record<string, unknown>) => void
  onDelete: (id: string, name: string) => void
}) {
  return (
    <div className="mt-3">
      <h3 className={labelCls}>
        {businesses.length > 1 ? `Businesses (${businesses.length})` : 'Business'}
      </h3>

      <ul className="mt-1 space-y-2">
        {businesses.map((b, i) => (
          <li key={b.id} className="rounded-md border border-neutral-200 p-2.5">
            <input
              className="w-full rounded border border-neutral-300 px-2 py-2.5 text-base text-neutral-900 outline-none focus:border-neutral-900 sm:py-1.5 sm:text-sm"
              placeholder="e.g. Cloud's Moving & Storage"
              defaultValue={b.name}
              onBlur={(e) => {
                const name = e.target.value.trim()
                if (name && name !== b.name) onPatch(b.id, { name })
                // A blanked-out name is a removal typed the long way round, but
                // deleting on blur would be a trap. Put the old one back.
                else if (!name) e.target.value = b.name
              }}
            />
            <div className="mt-2 flex items-center gap-2">
              <input
                className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-2 text-base text-neutral-700 outline-none focus:border-neutral-900 sm:py-1.5 sm:text-xs"
                placeholder="Type (optional)"
                defaultValue={categoryLabel(b.category) ?? ''}
                onBlur={(e) => {
                  const category = e.target.value.trim() || null
                  if (category !== (categoryLabel(b.category) ?? null)) onPatch(b.id, { category })
                }}
              />
              <button
                onClick={() => onDelete(b.id, b.name)}
                className={`shrink-0 px-1 text-xs text-neutral-500 underline underline-offset-2 ${TAP}`}
              >
                Remove
              </button>
            </div>
            {/* Which name the map prints, and where an unfamiliar one came from. */}
            <p className="mt-1.5 text-[11px] text-neutral-500">
              {i === 0 ? 'Shown on the map · ' : ''}
              {b.source === 'overture' ? 'From Overture Maps — check it' : 'Entered by hand'}
            </p>
          </li>
        ))}
      </ul>

      {businesses.length === 0 && (
        <p className="mt-1 text-[11px] text-neutral-500">
          No business recorded here yet. Businesses are not counted as homes.
        </p>
      )}

      <button
        onClick={onAdd}
        className={`mt-2 rounded-md border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-800 ${TAP}`}
      >
        Add business
      </button>
    </div>
  )
}

function HouseholdForm({
  household,
  showAddress,
  canAddHousehold,
  saving,
  onLocalChange,
  onCommit,
  onSaved,
  onDelete,
  onAddHousehold,
}: {
  household: Household
  showAddress: boolean
  canAddHousehold: boolean
  saving: boolean
  onLocalChange: (p: Partial<Household>) => void
  onCommit: (body: Record<string, unknown>) => Promise<boolean>
  onSaved: () => void
  onDelete: () => void
  onAddHousehold: () => void
}) {
  /**
   * Every field is controlled so Save can send the form as it stands.
   *
   * Previously Notes and Address only reached the server through their own blur
   * handler, so Save wrote a body that did not contain them — and tapping Save
   * straight from the notes box raced its own blur. Remounted per household by
   * the `key` on this component, so these initialisers re-run on switch.
   */
  const [familyName, setFamilyName] = useState(household.family_name)
  const [address, setAddress] = useState(household.address ?? '')
  const [status, setStatus] = useState<HouseholdStatus>(household.status)
  const [notes, setNotes] = useState(household.notes ?? '')
  const [people, setPeople] = useState<Person[]>(household.people)
  /** Set by any edit, cleared by any write — see commitIfDirty. */
  const dirty = useRef(false)

  /** The whole household, in the shape PATCH /api/households/:id expects. */
  const fullBody = useCallback(
    (nextPeople: Person[] = people): Record<string, unknown> => ({
      // A blank name would fail validation and lose the rest of the edit with it.
      family_name: familyName.trim() || household.family_name,
      status,
      notes: notes.trim() || null,
      ...(showAddress ? { address: address.trim() || null } : {}),
      // A person with no name yet is a half-typed row, not a deletion.
      people: nextPeople
        .filter((p) => p.full_name.trim())
        .map((p) => ({
          ...(p.id.startsWith('new:') ? {} : { id: p.id }),
          full_name: p.full_name.trim(),
          role: p.role?.trim() || null,
          phone: p.phone?.trim() || null,
          email: p.email?.trim() || null,
        })),
    }),
    [familyName, address, status, notes, people, showAddress, household.family_name],
  )

  /**
   * Autosave. Still sends the complete household rather than the one field that
   * changed: a phone in a parking lot drops requests, and a full body means the
   * next successful write repairs whatever the last one lost.
   */
  const commit = useCallback(
    (nextPeople?: Person[]) => {
      dirty.current = false
      void onCommit(fullBody(nextPeople))
    },
    [onCommit, fullBody],
  )

  /** Blurring an untouched field should not fire a PATCH. */
  const commitIfDirty = useCallback(() => {
    if (dirty.current) commit()
  }, [commit])

  function commitPeople(next: Person[]) {
    setPeople(next)
    commit(next)
  }

  function editPerson(i: number, patch: Partial<Person>) {
    dirty.current = true
    setPeople((prev) => prev.map((q, j) => (j === i ? { ...q, ...patch } : q)))
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
          value={familyName}
          onChange={(e) => {
            dirty.current = true
            setFamilyName(e.target.value)
          }}
          // Autosave on blur, plus the explicit Save button below.
          onBlur={() => {
            if (familyName.trim()) onLocalChange({ family_name: familyName.trim() })
            commitIfDirty()
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
            value={address}
            onChange={(e) => {
              dirty.current = true
              setAddress(e.target.value)
            }}
            onBlur={commitIfDirty}
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
          value={status}
          onChange={(e) => {
            const v = e.target.value as HouseholdStatus
            setStatus(v)
            onLocalChange({ status: v })
            // Sent from the event value: `status` is one render behind here.
            dirty.current = false
            void onCommit({ ...fullBody(), status: v })
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
          value={notes}
          onChange={(e) => {
            dirty.current = true
            setNotes(e.target.value)
          }}
          onBlur={commitIfDirty}
        />
      </div>

      <section>
        <h3 className="text-xs font-semibold text-neutral-900">People</h3>
        <ul className="mt-2 space-y-3">
          {people.map((p, i) => (
            <li key={p.id} className="rounded-md border border-neutral-200 p-2.5">
              <div className="flex gap-2">
                <input
                  className={`min-w-0 flex-1 rounded border border-neutral-300 px-2 py-2.5 text-base sm:py-1.5 sm:text-sm ${TAP}`}
                  placeholder="Full name"
                  value={p.full_name}
                  onChange={(e) => editPerson(i, { full_name: e.target.value })}
                  onBlur={commitIfDirty}
                />
                <input
                  className={`w-24 rounded border border-neutral-300 px-2 py-2.5 text-base sm:py-1.5 sm:text-sm ${TAP}`}
                  placeholder="Role"
                  value={p.role ?? ''}
                  onChange={(e) => editPerson(i, { role: e.target.value || null })}
                  onBlur={commitIfDirty}
                />
              </div>
              {/* Stacked on a phone: side by side, neither field shows enough of
                  a phone number or an email to check it. */}
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  className={`min-w-0 flex-1 rounded border border-neutral-300 px-2 py-2.5 text-base sm:py-1.5 sm:text-sm ${TAP}`}
                  placeholder="Phone"
                  type="tel"
                  inputMode="tel"
                  value={p.phone ?? ''}
                  onChange={(e) => editPerson(i, { phone: e.target.value || null })}
                  onBlur={commitIfDirty}
                />
                <input
                  className={`min-w-0 flex-1 rounded border border-neutral-300 px-2 py-2.5 text-base sm:py-1.5 sm:text-sm ${TAP}`}
                  placeholder="Email"
                  type="email"
                  inputMode="email"
                  value={p.email ?? ''}
                  onChange={(e) => editPerson(i, { email: e.target.value || null })}
                  onBlur={commitIfDirty}
                />
              </div>
              {/* Call and text are the whole point of this record on a phone, so
                  they get real buttons rather than inline links. */}
              <div className="mt-2 flex items-center gap-2 text-xs">
                {p.phone && (
                  <>
                    <a
                      href={`tel:${p.phone}`}
                      className="flex min-h-9 items-center rounded-md border border-blue-200 bg-blue-50 px-3 font-medium text-blue-700"
                    >
                      Call
                    </a>
                    <a
                      href={`sms:${p.phone}`}
                      className="flex min-h-9 items-center rounded-md border border-blue-200 bg-blue-50 px-3 font-medium text-blue-700 sm:hidden"
                    >
                      Text
                    </a>
                  </>
                )}
                {p.email && (
                  <a
                    href={`mailto:${p.email}`}
                    className="flex min-h-9 items-center rounded-md border border-blue-200 bg-blue-50 px-3 font-medium text-blue-700"
                  >
                    Email
                  </a>
                )}
                <button
                  onClick={() => commitPeople(people.filter((_, j) => j !== i))}
                  className="ml-auto min-h-9 px-1 text-neutral-500 underline underline-offset-2"
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
          className={`mt-2 rounded-md border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-800 ${TAP}`}
        >
          Add person
        </button>
      </section>

      <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-4">
        <button
          disabled={saving}
          // Writes the form exactly as it stands, then hands back to the panel,
          // which closes the sheet on a phone and leaves the side panel up.
          onClick={async () => {
            dirty.current = false
            if (await onCommit(fullBody())) onSaved()
          }}
          className={`rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 ${TAP}`}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {canAddHousehold && (
          <button
            onClick={onAddHousehold}
            className={`rounded-md border border-neutral-300 px-3 py-2.5 text-sm text-neutral-800 ${TAP}`}
          >
            Add household
          </button>
        )}
        <button
          onClick={onDelete}
          className={`ml-auto rounded-md px-3 py-2.5 text-sm text-red-700 underline underline-offset-2 ${TAP}`}
        >
          Delete this household
        </button>
      </div>
    </div>
  )
}
