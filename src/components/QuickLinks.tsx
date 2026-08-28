'use client'

import { useMemo, useState } from 'react'
import { displayUrl, shareSummary, type QuickLink, type ShareCandidate } from '@/lib/quick-links'
import {
  btnDanger,
  btnPrimary,
  btnQuiet,
  btnSmall,
  checkBox,
  checkRow,
  field,
  labelCls,
} from './form-styles'

/**
 * The links on the dashboard that are not pages of this app — LCR, the ward
 * calendar, whatever else the ward runs on — and, for an admin, the editor for
 * them.
 *
 * Two modes, because the two jobs want opposite things. Nearly every visit is
 * somebody opening a link they already know the name of, so the resting state is
 * names and nothing else: no addresses, no audiences, no buttons. The addresses
 * were the worst of it — the label is the link, and a wrapped Google Docs URL
 * under every row is a line of noise that says nothing the label did not.
 * Pressing Edit brings all of that back at once, for the few minutes a year
 * anybody is actually changing the list.
 *
 * The editor lives here rather than on an admin page, for the same reason the
 * meeting hours are edited from the building map: this is a short list that
 * changes a few times a year, and a page of its own would be a page with four
 * rows on it forever. The routes behind it require an admin independently, so
 * hiding the buttons is presentation and not the gate — and the private links
 * are filtered in the query, so a non-admin's page never contains one.
 *
 * State is held locally and seeded from the server render. Each write returns
 * the stored row and that is what goes into the list, so what is on screen is
 * what is in the table — including the `https://` the route added to a URL
 * somebody pasted without one, and the audience as it was actually saved.
 */
export default function QuickLinks({
  initial,
  canManage,
  people,
}: {
  initial: QuickLink[]
  canManage: boolean
  /** Who a link can be shared with. Empty for anybody who cannot manage them. */
  people: ShareCandidate[]
}) {
  const [links, setLinks] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Edit mode: the whole section, not one row. */
  const [managing, setManaging] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  /** Leaving edit mode puts every row back, so Done means done. */
  function stopManaging() {
    setManaging(false)
    setAdding(false)
    setEditingId(null)
    setConfirmingId(null)
    setError(null)
  }

  /**
   * One place for every write, so the busy flag and the error line cannot get
   * out of step with each other. The route's own sentence is preferred when it
   * sends one — it knows what was wrong with the URL and this does not.
   */
  async function send(url: string, init: RequestInit, fallback: string): Promise<QuickLink | null> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, {
        ...init,
        headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      })
      const body = (await res.json().catch(() => null)) as
        | (QuickLink & { error?: string })
        | { error?: string }
        | null
      if (!res.ok) {
        setError(body?.error ?? fallback)
        return null
      }
      return body as QuickLink
    } catch {
      setError('Not saved — check your connection and try again.')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function create(label: string, url: string, sharedWith: string[]) {
    const row = await send(
      '/api/quick-links',
      { method: 'POST', body: JSON.stringify({ label, url, shared_with: sharedWith }) },
      'Could not add that link.',
    )
    if (!row) return false
    setLinks((prev) => [...prev, row])
    setAdding(false)
    return true
  }

  async function update(id: string, label: string, url: string, sharedWith: string[]) {
    const row = await send(
      `/api/quick-links/${id}`,
      { method: 'PATCH', body: JSON.stringify({ label, url, shared_with: sharedWith }) },
      'Could not save that link.',
    )
    if (!row) return false
    setLinks((prev) => prev.map((l) => (l.id === row.id ? row : l)))
    setEditingId(null)
    return true
  }

  async function remove(id: string) {
    const ok = await send(
      `/api/quick-links/${id}`,
      { method: 'DELETE' },
      'Could not remove that link.',
    )
    if (!ok) return
    setLinks((prev) => prev.filter((l) => l.id !== id))
    setConfirmingId(null)
  }

  // Nothing to show and nothing anybody here can do about it: the section
  // disappears rather than sitting on the dashboard as an empty box.
  if (links.length === 0 && !canManage) return null

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
          Quick links
        </h2>
        {canManage && (
          <button
            type="button"
            onClick={() => (managing ? stopManaging() : setManaging(true))}
            aria-expanded={managing}
            className={`-mr-1 min-h-9 rounded-md px-2 text-xs font-medium ${
              managing
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-900'
            }`}
          >
            {managing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>

      <div className="mt-2 rounded-lg border border-neutral-200 bg-white shadow-sm">
        {links.length === 0 ? (
          <p className="p-5 text-sm text-neutral-600">
            {managing
              ? 'No links yet. Add the pages the ward keeps going back to — LCR, the calendar, a signup sheet.'
              : 'No links yet. Press Edit to add one.'}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {links.map((link) =>
              managing && editingId === link.id ? (
                <li key={link.id} className="p-3">
                  <LinkForm
                    initialLabel={link.label}
                    initialUrl={link.url}
                    initialShared={link.shared_with}
                    people={people}
                    submitLabel="Save"
                    busy={busy}
                    onSubmit={(label, url, shared) => update(link.id, label, url, shared)}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              ) : (
                <li key={link.id} className="flex items-center gap-2 px-3 sm:gap-3 sm:px-4">
                  {/* `min-w-0` so a long label truncates instead of pushing the
                      buttons off the side of a phone. */}
                  <a
                    href={link.url}
                    target="_blank"
                    // noreferrer as well as noopener: these point out of the app
                    // and the path somebody was on is nobody else's business.
                    rel="noopener noreferrer"
                    className="group flex min-w-0 flex-1 items-center gap-1.5 py-3"
                  >
                    <span className="truncate text-sm font-medium text-neutral-900 group-hover:underline">
                      {link.label}
                    </span>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      aria-hidden
                      className="h-3.5 w-3.5 shrink-0 text-neutral-400"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.5 6H18v4.5M17.5 6.5L10 14M15 15.5V18a1 1 0 01-1 1H6a1 1 0 01-1-1v-8a1 1 0 011-1h2.5"
                      />
                    </svg>
                    {/* Where the link goes and who it is for: in edit mode only.
                        Reading the list, the label is the whole of what anybody
                        needs; editing it, an admin needs to see which of these
                        the whole ward can open without opening each one. */}
                    {managing && (
                      <>
                        <span className="hidden min-w-0 truncate text-xs text-neutral-500 sm:inline">
                          {displayUrl(link.url)}
                        </span>
                        {link.shared_with.length > 0 && (
                          <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-amber-800">
                            {shareSummary(link, people)}
                          </span>
                        )}
                      </>
                    )}
                  </a>

                  {managing &&
                    (confirmingId === link.id ? (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => remove(link.id)}
                          className={btnDanger}
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          className={btnSmall}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setError(null)
                            setEditingId(link.id)
                            setAdding(false)
                          }}
                          className={btnSmall}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setError(null)
                            setConfirmingId(link.id)
                          }}
                          className={btnSmall}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                </li>
              ),
            )}
          </ul>
        )}

        {managing && (
          <div className="border-t border-neutral-200 p-3">
            {adding ? (
              <LinkForm
                initialLabel=""
                initialUrl=""
                initialShared={[]}
                people={people}
                submitLabel="Add link"
                busy={busy}
                onSubmit={create}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setAdding(true)
                  setEditingId(null)
                }}
                className={`${btnQuiet} w-full border-dashed text-neutral-600`}
              >
                + Add a link
              </button>
            )}
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </section>
  )
}

/**
 * The label, the address and the audience, used for both adding and editing —
 * they are the same three fields, and the only difference is what they start
 * out holding.
 *
 * The form stays open when a save fails so that what was typed is still there
 * to correct; `onSubmit` reporting true is what closes it.
 */
function LinkForm({
  initialLabel,
  initialUrl,
  initialShared,
  people,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initialLabel: string
  initialUrl: string
  initialShared: string[]
  people: ShareCandidate[]
  submitLabel: string
  busy: boolean
  onSubmit: (label: string, url: string, sharedWith: string[]) => Promise<boolean>
  onCancel: () => void
}) {
  const [label, setLabel] = useState(initialLabel)
  const [url, setUrl] = useState(initialUrl)
  const [everyone, setEveryone] = useState(initialShared.length === 0)
  const [shared, setShared] = useState<string[]>(initialShared)
  const [filter, setFilter] = useState('')

  /**
   * Ids with no row in `people` — a deactivated account, or somebody who has
   * since been made an admin. They are carried through a save untouched rather
   * than dropped: the tick boxes cannot show them, and silently unsharing
   * somebody because the picker had nothing to draw would be a change nobody
   * asked for.
   */
  const hidden = useMemo(
    () => initialShared.filter((id) => !people.some((p) => p.id === id)),
    [initialShared, people],
  )

  const needle = filter.trim().toLowerCase()
  const shown = needle
    ? people.filter(
        (p) => p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle),
      )
    : people

  const chosen = everyone ? [] : [...shared, ...hidden]
  const ready = label.trim().length > 0 && url.trim().length > 0 && (everyone || chosen.length > 0)

  function toggle(id: string) {
    setShared((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        if (!ready || busy) return
        await onSubmit(label.trim(), url.trim(), chosen)
      }}
      className="rounded-md border border-blue-300 bg-blue-50/60 p-2"
    >
      <div className="sm:flex sm:gap-2">
        <label className="block sm:w-44 sm:shrink-0">
          <span className={labelCls}>Label</span>
          <input
            type="text"
            value={label}
            maxLength={80}
            placeholder="LCR"
            disabled={busy}
            onChange={(e) => setLabel(e.target.value)}
            className={field}
          />
        </label>
        <label className="mt-2 block min-w-0 sm:mt-0 sm:flex-1">
          <span className={labelCls}>Address</span>
          {/* `type="url"` would put the browser's own "enter a URL" bubble in
              front of a hostname the route is willing to fix, so this is a text
              field and the route is the judge. */}
          <input
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={url}
            maxLength={2000}
            placeholder="lcr.churchofjesuschrist.org"
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
            className={field}
          />
        </label>
      </div>

      <fieldset className="mt-2">
        <legend className={labelCls}>Who can see it</legend>
        {/* Two segments rather than a checkbox reading "private": the open state
            is the default and it should say so out loud, because a link the
            whole ward can read is the thing worth being sure about. */}
        <div className="mt-1 flex w-full overflow-hidden rounded-md border border-neutral-300 bg-white">
          {[
            { on: true, label: 'Everyone' },
            { on: false, label: 'Only certain people' },
          ].map((choice) => (
            <button
              key={choice.label}
              type="button"
              disabled={busy}
              aria-pressed={everyone === choice.on}
              onClick={() => setEveryone(choice.on)}
              className={`min-h-11 flex-1 px-2 text-[13px] font-medium sm:min-h-9 ${
                everyone === choice.on
                  ? 'bg-blue-600 text-white'
                  : 'text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              {choice.label}
            </button>
          ))}
        </div>

        {!everyone && (
          <div className="mt-2 rounded-md border border-neutral-200 bg-white">
            {people.length === 0 ? (
              <p className="p-2 text-[11px] text-neutral-500">
                There are no other accounts to share with yet.
              </p>
            ) : (
              <>
                {/* Only once the list is long enough to scroll past — a filter
                    over six names is a field to tab through for nothing. */}
                {people.length > 8 && (
                  <div className="border-b border-neutral-200 p-1.5">
                    <input
                      type="search"
                      value={filter}
                      placeholder="Find a person"
                      disabled={busy}
                      onChange={(e) => setFilter(e.target.value)}
                      className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-neutral-900 outline-none focus:border-neutral-900"
                    />
                  </div>
                )}
                <div className="max-h-48 overflow-y-auto overscroll-contain px-2 py-1">
                  {shown.length === 0 ? (
                    <p className="py-2 text-[11px] text-neutral-500">Nobody by that name.</p>
                  ) : (
                    shown.map((person) => (
                      <label key={person.id} className={checkRow}>
                        <input
                          type="checkbox"
                          checked={shared.includes(person.id)}
                          disabled={busy}
                          onChange={() => toggle(person.id)}
                          className={checkBox}
                        />
                        <span className="min-w-0 truncate">
                          {person.name}
                          <span className="text-neutral-500"> · {person.email}</span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </>
            )}
            <p className="border-t border-neutral-200 px-2 py-1.5 text-[10px] leading-snug text-neutral-500">
              Admins can see every link, so they are not listed.
              {hidden.length > 0 &&
                ` ${hidden.length} other ${
                  hidden.length === 1 ? 'account' : 'accounts'
                } this was shared with are not shown here and will be kept.`}
            </p>
          </div>
        )}
      </fieldset>

      <div className="mt-2 flex gap-2">
        <button type="submit" disabled={busy || !ready} className={btnPrimary}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={btnQuiet}>
          Cancel
        </button>
      </div>
      {!everyone && chosen.length === 0 && (
        <p className="mt-1 text-[11px] text-neutral-600">
          Pick at least one person, or share it with everyone.
        </p>
      )}
    </form>
  )
}
