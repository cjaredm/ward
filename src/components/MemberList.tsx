'use client'

import { useCallback, useMemo, useState } from 'react'
import Avatar from '@/components/Avatar'
import HouseholdForm from '@/components/HouseholdForm'
import { TAP } from '@/components/form-styles'
import { STATUS_COLORS } from '@/lib/map-style'
import {
  HOUSEHOLD_STATUSES,
  STATUS_LABELS,
  type Household,
  type HouseholdStatus,
  type Person,
} from '@/lib/types'

/** A household plus the county address of the parcel behind it, if any. */
export type MemberHousehold = Household & { parcel_address: string | null }

type SaveState = { status: 'idle' | 'saving' | 'saved' | 'error'; message?: string }

/** What a household is listed at: its own typed address, else the county one. */
function addressOf(h: MemberHousehold): string | null {
  return h.address ?? h.parcel_address ?? null
}

/**
 * One line of the list: a person, or a household that has nobody recorded in it
 * yet. Households with no people still get a row — they are the ones most in
 * need of editing, so hiding them would defeat the page.
 */
type Row = {
  key: string
  household: MemberHousehold
  person: Person | null
  /** Everything the search box matches against, lowercased once up front. */
  haystack: string
}

export default function MemberList({
  households: initial,
  actorName,
}: {
  households: MemberHousehold[]
  actorName: string
}) {
  const [households, setHouseholds] = useState(initial)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<HouseholdStatus | 'all'>('all')
  /** The household whose editor is open. One at a time: this is a list, not a form. */
  const [openId, setOpenId] = useState<string | null>(null)
  const [save, setSave] = useState<SaveState>({ status: 'idle' })

  const rows = useMemo<Row[]>(
    () =>
      households.flatMap((h) => {
        const context = [h.family_name, addressOf(h) ?? ''].join(' ')
        if (h.people.length === 0) {
          const empty: Row = { key: h.id, household: h, person: null, haystack: context.toLowerCase() }
          return [empty]
        }
        return h.people.map((p): Row => ({
          key: p.id,
          household: h,
          person: p,
          // Callings are in here too: "who is the ward clerk" is a name lookup
          // the org chart answers, but people search here first.
          haystack: [p.full_name, context, ...p.callings.map((c) => c.name)]
            .join(' ')
            .toLowerCase(),
        }))
      }),
    [households],
  )

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (statusFilter === 'all' || r.household.status === statusFilter) &&
        (!needle || r.haystack.includes(needle)),
    )
  }, [rows, query, statusFilter])

  /**
   * Re-read one household after a write.
   *
   * The open editor keeps its own copy of the form, so this is for the list
   * behind it: a renamed family or a removed person has to change the row it was
   * edited from, and the server is the only thing that knows the new person ids.
   */
  const refresh = useCallback(async (id: string) => {
    const res = await fetch(`/api/households/${id}`)
    if (!res.ok) return
    const body = (await res.json()) as { households: Household[] }
    const fresh = body.households[0]
    if (!fresh) return
    setHouseholds((prev) => prev.map((h) => (h.id === id ? { ...h, ...fresh } : h)))
  }, [])

  const patch = useCallback(
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
        setSave({ status: 'saved' })
        await refresh(id)
        return true
      } catch {
        setSave({ status: 'error', message: 'Not saved — check your connection and press Save.' })
        return false
      }
    },
    [refresh],
  )

  /** Optimistic, so a name typed in the form changes its row as you type it. */
  const updateLocal = useCallback((id: string, fields: Partial<Household>) => {
    setHouseholds((prev) => prev.map((h) => (h.id === id ? { ...h, ...fields } : h)))
  }, [])

  async function remove(h: MemberHousehold) {
    if (
      !confirm(
        `Delete "${h.family_name}"? This permanently removes the names and notes on this household.`,
      )
    )
      return
    const res = await fetch(`/api/households/${h.id}`, { method: 'DELETE' })
    if (!res.ok) {
      setSave({ status: 'error', message: 'Could not delete household.' })
      return
    }
    setHouseholds((prev) => prev.filter((x) => x.id !== h.id))
    setOpenId(null)
    setSave({ status: 'idle' })
  }

  return (
    <div>
      {/* Sticky so the filters stay reachable partway down a few hundred rows. */}
      <div className="sticky top-0 z-10 -mx-4 mb-3 border-b border-neutral-200 bg-neutral-50 px-4 py-3 sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="search"
            // Not `type="text"`: on a phone this gets the clear button and a
            // keyboard with no autocorrect mangling surnames.
            placeholder="Search name, family, address or calling"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2.5 text-base text-neutral-900 outline-none focus:border-neutral-900 sm:py-2 sm:text-sm ${TAP}`}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as HouseholdStatus | 'all')}
            aria-label="Filter by household status"
            className={`rounded-md border border-neutral-300 bg-white px-3 py-2.5 text-base text-neutral-900 outline-none focus:border-neutral-900 sm:py-2 sm:text-sm ${TAP}`}
          >
            <option value="all">All statuses</option>
            {HOUSEHOLD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {(query.trim() || statusFilter !== 'all') && (
          <p className="mt-2 text-xs text-neutral-500">
            {visible.length} {visible.length === 1 ? 'match' : 'matches'}
          </p>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
          Nobody matches that.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          {visible.map((r) => {
            const h = r.household
            const open = openId === h.id
            const address = addressOf(h)
            return (
              <li key={r.key}>
                <button
                  // Opening a second person in the same family closes the first:
                  // both rows edit one household, and two live copies of one
                  // record would race each other's autosave.
                  onClick={() => {
                    setOpenId(open ? null : h.id)
                    setSave({ status: 'idle' })
                  }}
                  aria-expanded={open}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50 ${
                    open ? 'bg-neutral-50' : ''
                  }`}
                >
                  {/* Same colour the map draws this household in. */}
                  <span
                    aria-hidden
                    className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: STATUS_COLORS[h.status] }}
                    title={STATUS_LABELS[h.status]}
                  />
                  {/* A face where there is one, initials where there is not. The
                      household rows with nobody in them get the grey placeholder,
                      which keeps every row's text on the same left edge. */}
                  <Avatar
                    name={r.person?.full_name ?? null}
                    photoUrl={r.person?.photo_url}
                    size={36}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-neutral-900">
                      {r.person ? (
                        r.person.full_name
                      ) : (
                        <span className="text-neutral-500 italic">Nobody recorded</span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-neutral-500">
                      {h.family_name}
                      {address ? ` · ${address}` : ' · no address on file'}
                      {h.parcel_id ? '' : ' · pin'}
                    </span>
                    {r.person && r.person.callings.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {r.person.callings.map((c) => (
                          <span
                            key={c.id}
                            className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-700"
                          >
                            {c.name}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span aria-hidden className="shrink-0 text-neutral-400">
                    {open ? '▾' : '▸'}
                  </span>
                </button>

                {open && (
                  <div className="border-t border-neutral-200 bg-neutral-50">
                    <HouseholdForm
                      key={h.id}
                      household={h}
                      // Only a pinned household has an address of its own to type;
                      // a parcel-backed one is listed at the county's.
                      showAddress={h.parcel_id === null}
                      // Households are added where they sit — on the map.
                      canAddHousehold={false}
                      saving={save.status === 'saving'}
                      onLocalChange={(fields) => updateLocal(h.id, fields)}
                      onCommit={(body) => patch(h.id, body)}
                      onSaved={() => setOpenId(null)}
                      onDelete={() => void remove(h)}
                    />
                    <p className="px-4 pb-3 text-xs">
                      {save.status === 'error' ? (
                        <span className="text-red-600">{save.message}</span>
                      ) : save.status === 'saving' ? (
                        <span className="text-neutral-500">Saving…</span>
                      ) : save.status === 'saved' ? (
                        <span className="text-neutral-500">
                          Saved by {h.updated_by ?? actorName}
                        </span>
                      ) : (
                        <span className="text-neutral-400">
                          Last edited{h.updated_by ? ` by ${h.updated_by}` : ''}
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
