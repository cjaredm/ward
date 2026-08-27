'use client'

import { MIN_VERTICES, canRemoveVertex, removeVertex } from '@/lib/floorplan-geom'
import { TAP } from './form-styles'
import type { Draft } from './BuildingCanvas'

/**
 * The card that drives tracing a new room or fixing an existing one.
 *
 * Tracing and reshaping are the same operation with a different starting point —
 * an empty ring or a saved one — so they share one control card rather than two
 * modes that drift apart. The ward map's tracer is append-only and has no
 * equivalent of the reshape half at all.
 */
export default function RoomOutlineEditor({
  draft,
  roomName,
  busy,
  coarse,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Draft
  /** The room being reshaped, or null while tracing a new one. */
  roomName: string | null
  busy: boolean
  /** True on a touch device, so the copy says Tap rather than Click. */
  coarse: boolean
  onChange: (next: Draft) => void
  onSave: () => void
  onCancel: () => void
}) {
  const { points, active } = draft
  const tracing = draft.roomKey === null
  const enough = points.length >= MIN_VERTICES
  const verb = coarse ? 'Tap' : 'Click'
  // The same rule the Backspace/Delete keys go through, so the button being
  // greyed out and the key doing nothing always mean the same thing.
  const removable = canRemoveVertex(points, active)

  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/95 p-2.5 shadow-sm">
      <p className="text-[11px] leading-snug text-neutral-700">
        {tracing ? (
          <>
            <span className="font-medium">Tracing a new room.</span> {verb} each corner ·{' '}
            {points.length} point{points.length === 1 ? '' : 's'}
            {enough ? '' : ` · ${3 - points.length} more needed`}
          </>
        ) : (
          <>
            <span className="font-medium">Fixing {roomName ?? 'this room'}.</span> Drag a corner to
            move it, {coarse ? 'tap' : 'click'} a ⊕ to add one, {coarse ? 'tap' : 'select'} one and
            press Delete to remove it · {points.length} point{points.length === 1 ? '' : 's'}
          </>
        )}
      </p>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onSave}
          disabled={!enough || busy}
          className={`flex-1 rounded-md bg-blue-600 px-2.5 text-xs font-medium text-white disabled:opacity-40 ${TAP}`}
        >
          {busy ? 'Saving…' : tracing ? 'Save room' : 'Save outline'}
        </button>

        {tracing ? (
          <button
            type="button"
            onClick={() => onChange({ ...draft, points: points.slice(0, -1), active: null })}
            disabled={points.length === 0}
            className={`rounded-md border border-neutral-300 bg-white px-2.5 text-xs text-neutral-800 disabled:opacity-40 ${TAP}`}
          >
            Undo
          </button>
        ) : (
          <>
            <button
              type="button"
              // Removing a corner is a two-step — select it, then press this —
              // rather than a double-tap or a long press. On a phone both of
              // those fight the drag, and neither is discoverable.
              onClick={() =>
                onChange({ ...draft, points: removeVertex(points, active), active: null })
              }
              disabled={!removable}
              title={
                active === null
                  ? 'Select a corner first'
                  : points.length <= MIN_VERTICES
                    ? 'A room needs at least three corners'
                    : `Remove corner ${active + 1} — or press Delete`
              }
              className={`rounded-md border border-neutral-300 bg-white px-2.5 text-xs text-neutral-800 disabled:opacity-40 ${TAP}`}
            >
              Remove point
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...draft, points: draft.original, active: null })}
              className={`rounded-md border border-neutral-300 bg-white px-2.5 text-xs text-neutral-800 ${TAP}`}
            >
              Revert
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onCancel}
          className={`rounded-md border border-neutral-300 bg-white px-2.5 text-xs text-neutral-800 ${TAP}`}
        >
          Cancel
        </button>
      </div>

      {!tracing && active !== null && (
        <p className="text-[11px] text-amber-800">
          Corner {active + 1} selected.{' '}
          {removable
            ? 'Press Delete to remove it.'
            : 'A room needs at least three corners.'}
        </p>
      )}
    </div>
  )
}
