'use client'

import { useCallback, useRef, useState } from 'react'
import { orgLabel } from '@/lib/orgs'
import { MAX_PHOTO_URL } from '@/lib/photo'
import Avatar from '@/components/Avatar'
import { TAP, field, labelCls } from '@/components/form-styles'
import {
  HOUSEHOLD_STATUSES,
  STATUS_LABELS,
  type Household,
  type HouseholdStatus,
  type Person,
} from '@/lib/types'

/**
 * One household, editable: family name, status, notes, and who lives there.
 *
 * Shared by the map panel and the member list so the two cannot drift apart —
 * editing a family from a list row is the same form as editing it from its
 * parcel, with the same autosave-on-blur behaviour.
 *
 * Callers own the write. `onCommit` gets the whole household as a PATCH body and
 * answers whether it landed; everything about saving state, optimistic list
 * updates and error banners belongs to whoever rendered this.
 */
export default function HouseholdForm({
  household,
  showAddress,
  canAddHousehold,
  saving,
  onLocalChange,
  onCommit,
  onSaved,
  onDelete,
  onDetach,
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
  /** Absent for a household that is already a pin — there is nothing to detach from. */
  onDetach?: () => void
  /** Absent where a second household at this address makes no sense. */
  onAddHousehold?: () => void
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
          // Always sent, because the server writes the row from this body: an
          // omitted photo_url would clear a photo somebody else set.
          photo_url: p.photo_url?.trim() || null,
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
              <div className="flex items-center gap-2">
                <Avatar name={p.full_name || null} photoUrl={p.photo_url} size={32} />
                <input
                  className={`min-w-0 flex-1 rounded border border-neutral-300 px-2 py-2.5 text-base sm:py-1.5 sm:text-sm ${TAP}`}
                  placeholder="Full name"
                  value={p.full_name}
                  onChange={(e) => editPerson(i, { full_name: e.target.value })}
                  onBlur={commitIfDirty}
                />
                <button
                  onClick={() => commitPeople(people.filter((_, j) => j !== i))}
                  className={`shrink-0 px-1 text-xs text-neutral-500 underline underline-offset-2 ${TAP}`}
                >
                  Remove
                </button>
              </div>
              {/* Optional, and https only -- the server drops anything else
                  rather than rendering it. Left as a URL box rather than an
                  upload: the app stores no images, so the picture stays wherever
                  it is already hosted. */}
              <input
                className={`mt-2 w-full rounded border border-neutral-200 px-2 py-2.5 text-base text-neutral-600 sm:py-1.5 sm:text-sm ${TAP}`}
                type="url"
                inputMode="url"
                maxLength={MAX_PHOTO_URL}
                placeholder="Photo URL (optional, https)"
                value={p.photo_url ?? ''}
                onChange={(e) => editPerson(i, { photo_url: e.target.value || null })}
                onBlur={commitIfDirty}
              />
              {/* Callings and organizations, read-only: they come from the LCR
                  callings report on /admin/import, and hand-editing them here
                  would be overwritten by the next upload. */}
              {(p.callings.length > 0 || p.orgs.length > 0) && (
                <div className="mt-2 flex flex-wrap gap-1 text-xs">
                  {p.callings.map((c) => (
                    <span
                      key={c.id}
                      title={`${orgLabel(c.org_key)}${c.unit ? ` · ${c.unit}` : ''}`}
                      className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-700"
                    >
                      {c.name}
                    </span>
                  ))}
                  {p.orgs
                    .filter((o) => !p.callings.some((c) => c.org_key === o))
                    .map((o) => (
                      <span
                        key={o}
                        className="rounded border border-neutral-200 px-1.5 py-0.5 text-neutral-500"
                      >
                        {orgLabel(o)}
                      </span>
                    ))}
                </div>
              )}
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
                photo_url: null,
                sort_order: people.length,
                callings: [],
                orgs: [],
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
          // Writes the form exactly as it stands, then hands back to the caller,
          // which closes the sheet on a phone and leaves the side panel up.
          onClick={async () => {
            dirty.current = false
            if (await onCommit(fullBody())) onSaved()
          }}
          className={`rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 ${TAP}`}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {canAddHousehold && onAddHousehold && (
          <button
            onClick={onAddHousehold}
            className={`rounded-md border border-neutral-300 px-3 py-2.5 text-sm text-neutral-800 ${TAP}`}
          >
            Add household
          </button>
        )}
        {onDetach && (
          <button
            onClick={onDetach}
            title="Remove this family from the property and leave it as a draggable pin"
            className={`rounded-md border border-neutral-300 px-3 py-2.5 text-sm text-neutral-800 ${TAP}`}
          >
            Separate from property
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
