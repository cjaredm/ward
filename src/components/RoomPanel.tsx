'use client'

import { useEffect, useState } from 'react'
import {
  classOptionKey,
  classOptionLabel,
  classOptionTitle,
  classSections,
  parseClassOptionKey,
  roomAvailability,
  slotLabel,
} from '@/lib/building'
import type { BuildingRoom, ClassOption, MeetingSlot, RoomAssignment } from '@/lib/types'
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

export type AssignmentDraft = {
  title: string
  org_key: string | null
  unit: string
}

/**
 * One room: what it is called, what meets in it all Sunday, and how to fix it.
 *
 * Every hour is listed, not just the one the map is showing. Somebody who has
 * opened a room wants that room's whole Sunday — "is 101 free second hour" is the
 * next question after "what is in 101 now", and it should not need the map.
 *
 * Side panel on a laptop, bottom sheet on a phone, following ParcelPanel.
 */
export default function RoomPanel({
  room,
  slots,
  assignments,
  classOptions,
  taken,
  busy,
  warnings,
  availability,
  canEdit,
  onClose,
  onRename,
  onToggleAssignable,
  onSetSlotAvailability,
  onReshape,
  onZoomTo,
  onDeleteRoom,
  onAddAssignment,
  onEditAssignment,
  onDeleteAssignment,
}: {
  room: BuildingRoom
  slots: MeetingSlot[]
  /** Every assignment for this room, any hour. */
  assignments: RoomAssignment[]
  classOptions: ClassOption[]
  /**
   * The classes already scheduled somewhere, by hour, from `takenClassKeys`.
   * A class with a room this hour is not offered a second one.
   */
  taken: Map<string, Set<string>>
  busy: boolean
  warnings: string[]
  /** The per-hour availability overrides, from `indexAvailability`. */
  availability: Map<string, boolean>
  /**
   * False for an account with the building map but not its edit permission.
   * Every control that writes is left out rather than disabled: a greyed-out
   * form is a promise that ticking something else will enable it.
   */
  canEdit: boolean
  onClose: () => void
  onRename: (name: string) => void
  onToggleAssignable: (next: boolean) => void
  /**
   * Closes this room for one hour, or — with null — puts it back to following
   * the room's own switch. Null rather than `true` for the normal case so the
   * overrides table only ever holds decisions somebody actually made.
   */
  onSetSlotAvailability: (slotId: string, next: boolean | null) => void
  onReshape: () => void
  onZoomTo: () => void
  onDeleteRoom: () => void
  onAddAssignment: (slotId: string, draft: AssignmentDraft) => void
  onEditAssignment: (id: string, draft: AssignmentDraft) => void
  onDeleteAssignment: (id: string) => void
}) {
  /**
   * True while this is a bottom sheet rather than a side panel — the sheet covers
   * the drawing, so it matters for how much is shown at once.
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

  const active = slots.filter((s) => s.is_active)

  return (
    <aside
      className="absolute inset-x-0 bottom-0 z-20 flex max-h-[75dvh] flex-col rounded-t-2xl bg-white shadow-2xl ring-1 ring-black/10 sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[24rem] sm:rounded-none sm:rounded-l-2xl"
      aria-label="Room details"
    >
      <header className="shrink-0 rounded-t-2xl border-b border-neutral-200 bg-neutral-100 px-4 pt-2 pb-3 sm:rounded-none sm:pt-3">
        <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full bg-neutral-300 sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {canEdit ? (
              <>
                <label className={labelCls}>Room name</label>
                <input
                  type="text"
                  // Keyed on the room so switching rooms reloads the field rather
                  // than keeping the previous room's half-typed name in it.
                  key={room.key}
                  defaultValue={room.name}
                  disabled={busy}
                  onBlur={(e) => {
                    const next = e.target.value.trim()
                    if (next && next !== room.name) onRename(next)
                  }}
                  className={field}
                />
              </>
            ) : (
              <h2 className="truncate text-base font-semibold text-neutral-900">{room.name}</h2>
            )}
            <p className="mt-1 font-mono text-[11px] text-neutral-500">{room.key}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-200 sm:h-8 sm:w-8"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {warnings.length > 0 && (
          <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2">
            {warnings.map((w) => (
              <p key={w} className="text-[11px] leading-snug text-amber-900">
                {w}
              </p>
            ))}
          </div>
        )}

        {!room.is_assignable ? (
          <p className="rounded-md border border-neutral-200 bg-neutral-50 p-2.5 text-[12px] leading-snug text-neutral-600">
            This space is marked as not holding classes, so it is grey on the map and left out of
            &ldquo;rooms free this hour&rdquo;.
            {canEdit && ' Tick the box below to schedule in it, and then each hour can be closed on its own.'}
          </p>
        ) : active.length === 0 ? (
          <p className="text-[12px] text-neutral-600">
            No hours on the schedule yet. Add one from the Hour card on the map.
          </p>
        ) : (
          <div className="space-y-3">
            {active.map((slot) => (
              <SlotSection
                key={slot.id}
                slot={slot}
                here={assignments.filter((a) => a.slot_id === slot.id)}
                classOptions={classOptions}
                taken={taken.get(slot.id)}
                busy={busy}
                compact={isSheet}
                canEdit={canEdit}
                available={roomAvailability(room, slot.id, availability)}
                onSetAvailability={(next) => onSetSlotAvailability(slot.id, next)}
                onAdd={(draft) => onAddAssignment(slot.id, draft)}
                onEdit={onEditAssignment}
                onDelete={onDeleteAssignment}
              />
            ))}
          </div>
        )}

        <div className="mt-4 space-y-2 border-t border-neutral-200 pt-3">
          <div className="flex gap-1.5">
            {canEdit && (
              <button type="button" onClick={onReshape} className={`${btnQuiet} flex-1`}>
                Fix outline
              </button>
            )}
            <button type="button" onClick={onZoomTo} className={`${btnQuiet} flex-1`}>
              Zoom to room
            </button>
          </div>

          {canEdit && (
            <>
              <label className={checkRow}>
                <input
                  type="checkbox"
                  checked={room.is_assignable}
                  disabled={busy}
                  onChange={(e) => onToggleAssignable(e.target.checked)}
                  className={checkBox}
                />
                Classes meet in here
              </label>

              <button type="button" onClick={onDeleteRoom} disabled={busy} className={btnDanger}>
                Delete this room
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  )
}

/** One hour's worth of this room: what is in it, and a way to add more. */
function SlotSection({
  slot,
  here,
  classOptions,
  taken,
  busy,
  compact,
  canEdit,
  available,
  onSetAvailability,
  onAdd,
  onEdit,
  onDelete,
}: {
  slot: MeetingSlot
  here: RoomAssignment[]
  classOptions: ClassOption[]
  /** The classes already in a room this hour, anywhere in the building. */
  taken: Set<string> | undefined
  busy: boolean
  compact: boolean
  /** False on a read-only account: the hour is listed, nothing can be changed. */
  canEdit: boolean
  /** Whether a class can meet in this room during this hour. */
  available: boolean
  onSetAvailability: (next: boolean | null) => void
  onAdd: (draft: AssignmentDraft) => void
  onEdit: (id: string, draft: AssignmentDraft) => void
  onDelete: (id: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <section>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-medium tracking-[0.06em] text-neutral-500 uppercase">
          {slotLabel(slot)}
        </h3>
        {/*
          Ticked stores nothing and unticked stores a `false`: the room already
          holds classes or this section would not be rendered, so "available" is
          the default and only the closure is a decision worth a row.
        */}
        {canEdit && (
          <label className={`${checkRow} shrink-0`}>
            <input
              type="checkbox"
              checked={available}
              disabled={busy}
              onChange={(e) => onSetAvailability(e.target.checked ? null : false)}
              className={checkBox}
            />
            Available
          </label>
        )}
      </div>

      <div className="mt-1 space-y-1.5">
        {!available && (
          <p className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-[12px] leading-snug text-neutral-600">
            Closed this hour — grey on the map, and not counted as free.
          </p>
        )}

        {available && here.length === 0 && !adding && (
          <p className="text-[12px] text-neutral-500">Nothing scheduled.</p>
        )}

        {here.map((a) =>
          editingId === a.id ? (
            <AssignmentForm
              key={a.id}
              initial={{ title: a.title, org_key: a.org_key, unit: a.unit }}
              classOptions={classOptions}
              taken={taken}
              busy={busy}
              compact={compact}
              submitLabel="Save"
              onSubmit={(draft) => {
                onEdit(a.id, draft)
                setEditingId(null)
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div
              key={a.id}
              className="flex items-start justify-between gap-2 rounded-md border border-neutral-200 px-2 py-1.5"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-neutral-900">{a.title}</p>
                {a.org_key && (
                  <p className="truncate text-[11px] text-neutral-500">
                    {classOptionLabel({ org_key: a.org_key, unit: a.unit, people: 0 })}
                  </p>
                )}
              </div>
              {canEdit && (
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditingId(a.id)}
                    aria-label={`Edit ${a.title}`}
                    className={btnSmall}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(a.id)}
                    disabled={busy}
                    aria-label={`Remove ${a.title}`}
                    className={`${btnSmall} border-red-300 text-red-700 hover:border-red-600`}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          ),
        )}

        {adding ? (
          <AssignmentForm
            classOptions={classOptions}
            taken={taken}
            busy={busy}
            compact={compact}
            submitLabel="Add"
            onSubmit={(draft) => {
              onAdd(draft)
              setAdding(false)
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          // No way in while the hour is closed, or on a read-only account: the
          // route refuses both anyway, and a form that always ends in an error is
          // worse than no form.
          canEdit &&
          available && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={`${btnQuiet} w-full border-dashed text-neutral-600`}
            >
              + Add a class
            </button>
          )
        )}
      </div>
    </section>
  )
}

/**
 * A class, and optionally which organization it is.
 *
 * The title is required and authoritative — it is what the map prints and what is
 * on the door. The org link is optional and only exists so this class can later be
 * resolved to its roster and its teachers. Picking one prefills the title and
 * leaves it editable, because the label and the link are allowed to disagree: on
 * a combined Sunday they will.
 */
function AssignmentForm({
  initial,
  classOptions,
  taken,
  busy,
  compact,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: AssignmentDraft
  classOptions: ClassOption[]
  taken: Set<string> | undefined
  busy: boolean
  compact: boolean
  submitLabel: string
  onSubmit: (draft: AssignmentDraft) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const mine = initial?.org_key ? classOptionKey(initial.org_key, initial.unit) : ''
  const [link, setLink] = useState(mine)

  // Alphabetical already, from `pickClassOptions` on the server; grouped here,
  // minus whatever has a room this hour. `mine` is passed so an assignment being
  // edited keeps its own class in its own picker.
  const sections = classSections(classOptions, taken, mine || null)

  const parsed = link ? parseClassOptionKey(link) : null

  return (
    <div className="space-y-1.5 rounded-md border border-blue-300 bg-blue-50/60 p-2">
      <label className="block">
        <span className={labelCls}>Class name</span>
        <input
          type="text"
          value={title}
          autoFocus={!compact}
          placeholder="Course 15"
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
          className={field}
        />
      </label>

      <label className="block">
        <span className={labelCls}>Ward class (optional)</span>
        <select
          value={link}
          disabled={busy}
          onChange={(e) => {
            setLink(e.target.value)
            const next = parseClassOptionKey(e.target.value)
            const option = next && classOptions.find(
              (o) => o.org_key === next.org_key && o.unit === next.unit,
            )
            // Only fills a blank title: retyping over somebody's wording because
            // they corrected the link would be worse than leaving it.
            if (option && !title.trim()) setTitle(classOptionTitle(option))
          }}
          className={field}
        >
          <option value="">Not linked</option>
          {/* The heading carries the organization, so the option is the class's
              own name rather than 'Sunday School › Course 15' repeated nine times. */}
          {sections.map((section) => (
            <optgroup key={section.label} label={section.label}>
              {section.options.map((o) => (
                <option
                  key={classOptionKey(o.org_key, o.unit)}
                  value={classOptionKey(o.org_key, o.unit)}
                >
                  {classOptionTitle(o)}
                  {o.people > 0 ? ` (${o.people})` : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="text-[10px] leading-snug text-neutral-500">
        Linking a class is what will let this room show its roster and its teachers later. Classes
        already in a room this hour are not listed.
      </p>

      <div className="flex gap-1.5 pt-0.5">
        <button
          type="button"
          disabled={busy || !title.trim()}
          onClick={() =>
            onSubmit({
              title: title.trim(),
              org_key: parsed?.org_key ?? null,
              unit: parsed?.unit ?? '',
            })
          }
          className={`${btnPrimary} flex-1`}
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={btnQuiet}>
          Cancel
        </button>
      </div>
    </div>
  )
}
