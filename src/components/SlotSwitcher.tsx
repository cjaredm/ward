'use client'

import { useState } from 'react'
import { slotLabel, slotTimes } from '@/lib/building'
import type { MeetingSlot } from '@/lib/types'
import { TAP, field, labelCls } from './form-styles'

/**
 * Which hour the map is showing, and — for an admin — what the hours are.
 *
 * The hours editor lives here rather than on an admin page of its own. It is two
 * rows that change twice a year; a page for it would be a page with two rows on
 * it forever. The routes behind it still require an admin, so the door is shut
 * independently of where the UI sits.
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
    <div className="rounded-lg border border-neutral-200 bg-white/95 p-2 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-medium tracking-[0.08em] text-neutral-500 uppercase">
          Hour
        </h2>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            className="rounded px-1.5 py-0.5 text-[11px] text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
          >
            {editing ? 'Done' : 'Edit hours'}
          </button>
        )}
      </div>

      {/* Scrolls sideways past four blocks rather than wrapping into a wall of
          pills that pushes the drawing down the screen. */}
      <div className="mt-1.5 -mx-0.5 flex snap-x gap-1.5 overflow-x-auto px-0.5 pb-0.5">
        {active.length === 0 && (
          <p className="px-1 py-1 text-[11px] text-neutral-500">No hours on the schedule.</p>
        )}
        {active.map((slot) => {
          const on = slot.id === activeId
          const label = slotLabel(slot)
          const times = slotTimes(slot)
          return (
            <button
              key={slot.id}
              type="button"
              onClick={() => onPick(slot.id)}
              aria-pressed={on}
              className={`${TAP} snap-start shrink-0 rounded-md px-2.5 py-1 text-left text-xs ${
                on
                  ? 'bg-blue-600 text-white'
                  : 'border border-neutral-300 text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              <span className="block font-medium">{label}</span>
              {label !== times && (
                <span className={`block text-[10px] ${on ? 'text-blue-100' : 'text-neutral-500'}`}>
                  {times}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {editing && isAdmin && (
        <div className="mt-2 space-y-2 border-t border-neutral-200 pt-2">
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
      <div className="flex gap-1.5">
        <label className="flex-1">
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
            className={field}
          />
        </label>
        <label className="flex-1">
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
            className={field}
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
        <label className="flex items-center gap-1.5 text-[11px] text-neutral-700">
          <input
            type="checkbox"
            checked={slot.is_active}
            disabled={busy}
            onChange={(e) => onUpdate({ is_active: e.target.checked })}
            className="h-4 w-4"
          />
          Meeting this year
        </label>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="text-[11px] text-red-700 underline underline-offset-2 disabled:opacity-40"
        >
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
        className={`w-full rounded-md border border-dashed border-neutral-300 px-2 text-xs text-neutral-600 hover:border-neutral-500 ${TAP}`}
      >
        + Add an hour
      </button>
    )
  }

  return (
    <div className="rounded-md border border-blue-300 bg-blue-50/60 p-1.5">
      <div className="flex gap-1.5">
        <label className="flex-1">
          <span className={labelCls}>Starts</span>
          <input type="time" value={starts} onChange={(e) => setStarts(e.target.value)} className={field} />
        </label>
        <label className="flex-1">
          <span className={labelCls}>Ends</span>
          <input type="time" value={ends} onChange={(e) => setEnds(e.target.value)} className={field} />
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
          className={`flex-1 rounded-md bg-blue-600 px-2 text-xs font-medium text-white disabled:opacity-40 ${TAP}`}
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={`rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-800 ${TAP}`}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
