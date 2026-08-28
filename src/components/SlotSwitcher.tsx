'use client'

import { useState } from 'react'
import { slotLabel, slotTimes } from '@/lib/building'
import type { MeetingSlot } from '@/lib/types'
import {
  btnDanger,
  btnPrimary,
  btnQuiet,
  checkBox,
  checkRow,
  field,
  fieldTight,
  labelCls,
} from './form-styles'

/**
 * Which hour the map is showing, and — for an admin — what the hours are.
 *
 * A row of hours in the bar rather than a card that folds: there are two of them
 * on a normal Sunday, and a chip reading 'Hour · First Class' that has to be
 * opened to change the hour costs a tap to say what one look already said. The
 * pills carry names only — a name is what anybody calls the hour, and the times
 * are in the tooltip and in the editor for the twice a year they matter.
 *
 * The hours editor lives here rather than on an admin page of its own. It is two
 * rows that change twice a year; a page for it would be a page with two rows on
 * it forever. The routes behind it still require an admin, so the door is shut
 * independently of where the UI sits.
 *
 * It opens in flow, under the pills, rather than floating over the map: the Key
 * hangs directly below this and a panel positioned over it covered the thing
 * somebody had just opened the editor beside.
 */
export default function SlotSwitcher({
  slots,
  activeId,
  isAdmin,
  busy,
  onPick,
  onCreate,
  onUpdate,
  onDelete,
}: {
  slots: MeetingSlot[]
  activeId: string | null
  isAdmin: boolean
  busy: boolean
  onPick: (id: string) => void
  onCreate: (body: { label: string | null; starts_at: string; ends_at: string }) => void
  onUpdate: (id: string, body: Partial<{ label: string | null; starts_at: string; ends_at: string; is_active: boolean }>) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const active = slots.filter((s) => s.is_active)

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-start gap-2">
        {/* One pill of segments, the same shape as the tool pill beside it, so
            the bar reads as one row of controls rather than a card and a strip. */}
        <div className="flex divide-x divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white/95 shadow-sm backdrop-blur-[2px]">
          {active.length === 0 ? (
            <span className="flex min-h-11 items-center px-3 text-[11px] whitespace-nowrap text-neutral-500 sm:min-h-9">
              No hours on the schedule
            </span>
          ) : (
            active.map((slot) => {
              const on = slot.id === activeId
              return (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => onPick(slot.id)}
                  aria-pressed={on}
                  title={slotTimes(slot)}
                  className={`min-h-11 px-3 text-[13px] font-medium whitespace-nowrap sm:min-h-9 ${
                    on ? 'bg-blue-600 text-white' : 'text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  {slotLabel(slot)}
                </button>
              )
            })
          )}
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            className={`min-h-11 shrink-0 rounded-lg border px-2.5 text-[11px] whitespace-nowrap shadow-sm backdrop-blur-[2px] sm:min-h-9 ${
              editing
                ? 'border-neutral-900 bg-neutral-900 text-white'
                : 'border-neutral-200 bg-white/95 text-neutral-600 hover:text-neutral-900'
            }`}
          >
            {editing ? 'Done' : 'Edit hours'}
          </button>
        )}
      </div>

      {editing && isAdmin && (
        // Scrolls inside itself: the editor with four hours in it is taller than
        // a phone held sideways.
        <div className="max-h-[60dvh] w-72 max-w-[calc(100vw-1.5rem)] space-y-2 overflow-y-auto overscroll-contain rounded-lg border border-neutral-200 bg-white p-2 shadow-lg">
          {slots.map((slot) => (
            <SlotRow
              key={slot.id}
              slot={slot}
              busy={busy}
              onUpdate={(body) => onUpdate(slot.id, body)}
              onDelete={() => onDelete(slot.id)}
            />
          ))}
          <AddSlot busy={busy} onCreate={onCreate} />
          <p className="text-[10px] leading-snug text-neutral-500">
            Moving an hour keeps every class already assigned to it. Switch an hour off rather
            than deleting it when it is not meeting this year.
          </p>
        </div>
      )}
    </div>
  )
}

/** `time` columns come back as 'HH:MM:SS'; <input type="time"> wants 'HH:MM'. */
function hhmm(time: string): string {
  return time.slice(0, 5)
}

function SlotRow({
  slot,
  busy,
  onUpdate,
  onDelete,
}: {
  slot: MeetingSlot
  busy: boolean
  onUpdate: (body: Partial<{ label: string | null; starts_at: string; ends_at: string; is_active: boolean }>) => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-md border border-neutral-200 p-1.5">
      {/* `min-w-0` on both columns: without it a flex item refuses to shrink
          below the width its content asks for, and a time input asks for more
          than half this panel. */}
      <div className="flex gap-1.5">
        <label className="min-w-0 flex-1">
          <span className={labelCls}>Starts</span>
          <input
            type="time"
            defaultValue={hhmm(slot.starts_at)}
            disabled={busy}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== hhmm(slot.starts_at)) {
                onUpdate({ starts_at: e.target.value })
              }
            }}
            className={fieldTight}
          />
        </label>
        <label className="min-w-0 flex-1">
          <span className={labelCls}>Ends</span>
          <input
            type="time"
            defaultValue={hhmm(slot.ends_at)}
            disabled={busy}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== hhmm(slot.ends_at)) {
                onUpdate({ ends_at: e.target.value })
              }
            }}
            className={fieldTight}
          />
        </label>
      </div>
      <label className="mt-1.5 block">
        <span className={labelCls}>Name (optional)</span>
        <input
          type="text"
          defaultValue={slot.label ?? ''}
          placeholder="Reads as its times"
          disabled={busy}
          onBlur={(e) => {
            const next = e.target.value.trim()
            if (next !== (slot.label ?? '')) onUpdate({ label: next || null })
          }}
          className={field}
        />
      </label>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <label className={checkRow}>
          <input
            type="checkbox"
            checked={slot.is_active}
            disabled={busy}
            onChange={(e) => onUpdate({ is_active: e.target.checked })}
            className={checkBox}
          />
          Meeting this year
        </label>
        <button type="button" onClick={onDelete} disabled={busy} className={btnDanger}>
          Delete
        </button>
      </div>
    </div>
  )
}

function AddSlot({
  busy,
  onCreate,
}: {
  busy: boolean
  onCreate: (body: { label: string | null; starts_at: string; ends_at: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [starts, setStarts] = useState('10:10')
  const [ends, setEnds] = useState('10:35')
  const [label, setLabel] = useState('')

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${btnQuiet} w-full border-dashed text-neutral-600`}
      >
        + Add an hour
      </button>
    )
  }

  return (
    <div className="rounded-md border border-blue-300 bg-blue-50/60 p-1.5">
      <div className="flex gap-1.5">
        <label className="min-w-0 flex-1">
          <span className={labelCls}>Starts</span>
          <input
            type="time"
            value={starts}
            onChange={(e) => setStarts(e.target.value)}
            className={fieldTight}
          />
        </label>
        <label className="min-w-0 flex-1">
          <span className={labelCls}>Ends</span>
          <input
            type="time"
            value={ends}
            onChange={(e) => setEnds(e.target.value)}
            className={fieldTight}
          />
        </label>
      </div>
      <label className="mt-1.5 block">
        <span className={labelCls}>Name (optional)</span>
        <input
          type="text"
          value={label}
          placeholder="Reads as its times"
          onChange={(e) => setLabel(e.target.value)}
          className={field}
        />
      </label>
      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          disabled={busy || !starts || !ends || ends <= starts}
          onClick={() => {
            onCreate({ label: label.trim() || null, starts_at: starts, ends_at: ends })
            setOpen(false)
            setLabel('')
          }}
          className={`${btnPrimary} flex-1`}
        >
          Add
        </button>
        <button type="button" onClick={() => setOpen(false)} className={btnQuiet}>
          Cancel
        </button>
      </div>
    </div>
  )
}
