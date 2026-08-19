'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import HouseholdForm from '@/components/HouseholdForm'
import { TAP, field, labelCls } from '@/components/form-styles'
import {
  PARCEL_USES,
  USE_LABELS,
  categoryLabel,
  type Business,
  type Household,
  type ParcelDetail,
  type ParcelUse,
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

  /**
   * Takes a household off its parcel and leaves it as a pin on the map.
   *
   * The mirror of dragging a pin onto a house: a family listed at the wrong
   * address is separated from it without losing the names and notes on the
   * record. The server puts the new pin on the parcel's centroid,
   * so it comes to rest on the house it just left.
   */
  async function detachHousehold(id: string, name: string) {
    if (
      !confirm(
        `Separate "${name}" from this property? The family stays on the map as a pin you can drag to the right house.`,
      )
    )
      return
    setSave({ status: 'saving' })
    const res = await fetch(`/api/households/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parcel_id: null }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setSave({ status: 'error', message: body?.error ?? 'Could not separate that household.' })
      return
    }
    setSave({ status: 'saved', at: Date.now() })
    onChanged()
    // The household is no longer part of this parcel, so the panel's current
    // view of it is stale either way; close and let the pin speak for itself.
    onClose()
  }

  async function deleteHousehold(id: string, name: string) {
    if (
      !confirm(
        `Delete "${name}"? This permanently removes the names and notes on this household.`,
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
            // Only a parcel-backed household has a property to be separated from.
            onDetach={
              target.kind === 'parcel'
                ? () => detachHousehold(household.id, household.family_name)
                : undefined
            }
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
