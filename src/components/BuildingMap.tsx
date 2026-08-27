'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ROOM_STATUS,
  conflicts,
  indexAssignments,
  indexAvailability,
  pickDefaultSlot,
  roomAvailability,
  roomStatus,
  slotLabel,
  takenClassKeys,
  type RoomStatus,
} from '@/lib/building'
import {
  MIN_VERTICES,
  canRemoveVertex,
  normalizeRing,
  removeVertex,
  type Pt,
} from '@/lib/floorplan-geom'
import { orgInk, orgLabel } from '@/lib/orgs'
import type { BuildingData, MeetingSlot, RoomAssignment } from '@/lib/types'
import BuildingCanvas, { type CanvasHandle, type Draft } from './BuildingCanvas'
import Clamped from './Clamped'
import RoomOutlineEditor from './RoomOutlineEditor'
import RoomPanel from './RoomPanel'
import SlotSwitcher from './SlotSwitcher'
import ToolButton from './ToolButton'
import { TAP } from './form-styles'

/**
 * The building map.
 *
 * Holds every piece of state the page has: which hour is showing, which room is
 * open, and the outline being traced or fixed. The canvas draws, the panel edits,
 * and this decides — the same division WardMap and ParcelPanel use.
 *
 * Opens with the data the server already read, so the first paint has the
 * building in it; every write re-reads /api/building rather than patching local
 * state, because a schedule two people are editing at once has to converge.
 */
export default function BuildingMap({
  initial,
  isAdmin,
  initialRoomKey,
  initialSlotId,
}: {
  initial: BuildingData
  actorName?: string
  isAdmin: boolean
  initialRoomKey: string | null
  initialSlotId: string | null
}) {
  const [data, setData] = useState(initial)
  const [slotId, setSlotId] = useState<string | null>(() => {
    if (initialSlotId && initial.slots.some((s) => s.id === initialSlotId)) return initialSlotId
    return pickDefaultSlot(initial.slots, new Date())?.id ?? null
  })
  const [selectedKey, setSelectedKey] = useState<string | null>(initialRoomKey)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listMode, setListMode] = useState(false)
  const [freeOnly, setFreeOnly] = useState(false)
  /**
   * Take the rooms nothing can meet in off the drawing. Off by default: the plan
   * with every outline on it is the one somebody recognises as their building,
   * and this is the second look, not the first.
   */
  const [hideClosed, setHideClosed] = useState(false)
  /** True on a touch device, so the copy says Tap rather than Click. */
  const [coarse, setCoarse] = useState(false)
  const canvas = useRef<CanvasHandle | null>(null)

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)')
    const sync = () => setCoarse(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const load = useCallback(async () => {
    const res = await fetch('/api/building', { cache: 'no-store' })
    if (!res.ok) {
      setError('Could not reload the building map.')
      return
    }
    setData((await res.json()) as BuildingData)
  }, [])

  /**
   * Every write goes through here: one place that shows a spinner, surfaces the
   * server's sentence rather than a status code, and re-reads afterwards.
   */
  const send = useCallback(
    async (
      url: string,
      method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      body?: unknown,
    ): Promise<{ ok: boolean; json: Record<string, unknown> }> => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(url, {
          method,
          cache: 'no-store',
          headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok) {
          setError(typeof json.error === 'string' ? json.error : 'That did not save.')
          return { ok: false, json }
        }
        await load()
        return { ok: true, json }
      } catch {
        setError('No connection. Nothing was saved.')
        return { ok: false, json: {} }
      } finally {
        setBusy(false)
      }
    },
    [load],
  )

  const availability = useMemo(() => indexAvailability(data.availability), [data.availability])

  /**
   * The classes already in a room, by hour, so the picker stops offering them.
   * Computed from every assignment rather than the open room's own — a class in
   * 104 must not still be on offer in 106.
   */
  const taken = useMemo(() => takenClassKeys(data.assignments), [data.assignments])

  const byRoom = useMemo(() => {
    const index = indexAssignments(data.assignments)
    return slotId ? (index.get(slotId) ?? new Map<string, RoomAssignment[]>()) : new Map()
  }, [data.assignments, slotId])

  const room = useMemo(
    () => data.rooms.find((r) => r.key === selectedKey) ?? null,
    [data.rooms, selectedKey],
  )

  const warnings = useMemo(() => {
    const names = new Map(data.rooms.map((r) => [r.key, r.name]))
    return conflicts(data.assignments.filter((a) => a.slot_id === slotId)).map(
      (c) =>
        `${c.title} is in ${c.room_keys.length} rooms this hour: ${c.room_keys
          .map((k) => names.get(k) ?? k)
          .join(', ')}.`,
    )
  }, [data.assignments, data.rooms, slotId])

  /**
   * The rooms a class could be put in this hour, and the ones that are still
   * empty — both per hour, so the chapel counts as a room second hour and not
   * during sacrament meeting.
   */
  const { usable, free } = useMemo(() => {
    const usable = data.rooms.filter((r) => roomAvailability(r, slotId, availability))
    return { usable, free: usable.filter((r) => !byRoom.has(r.key)) }
  }, [data.rooms, byRoom, availability, slotId])

  /**
   * Which of the three colours are actually on the drawing right now, so the key
   * does not explain a colour nothing is painted in.
   */
  const statuses = useMemo(() => {
    const seen = new Set<RoomStatus>()
    for (const r of data.rooms) {
      seen.add(roomStatus(r, slotId, availability, byRoom.get(r.key)?.length ?? 0))
    }
    return (['booked', 'free', 'closed'] as const).filter((k) => seen.has(k))
  }, [data.rooms, byRoom, availability, slotId])

  /** The organizations with a class somewhere this hour, for the legend. */
  const legend = useMemo(() => {
    const seen = new Map<string, string>()
    for (const a of data.assignments) {
      if (a.slot_id !== slotId || !a.org_key) continue
      if (!seen.has(a.org_key)) seen.set(a.org_key, a.title)
    }
    return [...seen.keys()].sort()
  }, [data.assignments, slotId])

  /** Escape unwinds one layer at a time, innermost first, as on the ward map. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
      if (typing) return

      if (e.key === 'Escape') {
        if (draft) setDraft(null)
        else if (selectedKey) setSelectedKey(null)
        return
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (!draft) return
        e.preventDefault()
        setDraft((d) => {
          if (!d) return d
          // A selected corner is what the key acts on, in either mode — it is the
          // one the handles and the Remove point button already talk about, and
          // reaching for Delete after tapping a corner is the obvious gesture.
          //
          // A saved room has to keep at least three corners; an outline still
          // being traced does not, because deleting back to nothing is how
          // somebody starts the trace over.
          if (d.active !== null) {
            const floor = d.roomKey === null ? 0 : MIN_VERTICES
            if (!canRemoveVertex(d.points, d.active, floor)) return d
            return { ...d, points: removeVertex(d.points, d.active, floor), active: null }
          }
          // Nothing selected. While tracing, the key walks the trace back a
          // corner at a time. On a reshape it does nothing at all: lopping a
          // corner off a saved room because somebody hit Backspace out of habit
          // is exactly the accident this guard exists for.
          if (d.roomKey !== null) return d
          return { ...d, points: d.points.slice(0, -1), active: null }
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft, selectedKey])

  async function saveDraft() {
    if (!draft) return
    const points = normalizeRing(draft.points)
    if (points.length < 3) return

    if (draft.roomKey === null) {
      const name = window.prompt('Room name (the number, or what it is called):', '')
      if (!name || !name.trim()) return
      const { ok, json } = await send('/api/building/rooms', 'POST', {
        name: name.trim(),
        points,
      })
      if (ok) {
        setDraft(null)
        if (typeof json.key === 'string') setSelectedKey(json.key)
      }
      return
    }

    const { ok } = await send(`/api/building/rooms/${draft.roomKey}`, 'PATCH', { points })
    if (ok) setDraft(null)
  }

  function startReshape(key: string) {
    const target = data.rooms.find((r) => r.key === key)
    if (!target) return
    setDraft({ roomKey: key, points: target.points, active: null, original: target.points })
  }

  async function deleteRoom(key: string, name: string) {
    if (!window.confirm(`Delete ${name}? Its outline is not recoverable from the map.`)) return
    const { ok } = await send(`/api/building/rooms/${key}`, 'DELETE')
    if (ok) setSelectedKey(null)
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-white">
      <BuildingCanvas
        rooms={data.rooms}
        assignments={byRoom}
        availability={availability}
        slotId={slotId}
        selectedKey={selectedKey}
        draft={draft}
        dimAssigned={freeOnly}
        hideClosed={hideClosed}
        onSelect={(key) => {
          if (draft) return
          setSelectedKey(key)
        }}
        onDraftChange={setDraft}
        onReady={(handle) => {
          canvas.current = handle
        }}
      />

      {/* One floating column rather than controls pinned to opposite corners: at
          phone width the two would collide and cover the drawing between them. */}
      <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2 sm:inset-x-3 sm:top-3">
        <div className="pointer-events-auto w-[15rem] space-y-2 sm:w-[17rem]">
          <SlotSwitcher
            slots={data.slots}
            activeId={slotId}
            isAdmin={isAdmin}
            busy={busy}
            onPick={setSlotId}
            onCreate={(body) => send('/api/building/slots', 'POST', body)}
            onUpdate={(id, body) => send(`/api/building/slots/${id}`, 'PATCH', body)}
            onDelete={(id) => {
              if (!window.confirm('Delete this hour?')) return
              void send(`/api/building/slots/${id}`, 'DELETE')
            }}
          />

          {draft ? (
            <RoomOutlineEditor
              draft={draft}
              roomName={data.rooms.find((r) => r.key === draft.roomKey)?.name ?? null}
              busy={busy}
              coarse={coarse}
              onChange={setDraft}
              onSave={saveDraft}
              onCancel={() => setDraft(null)}
            />
          ) : (
            <div className="rounded-lg border border-neutral-200 bg-white/95 p-2 shadow-sm">
              <div className="flex gap-1.5">
                <ToolButton
                  label="Trace a room"
                  hint="Draw an outline for a room the plan does not have yet"
                  align="left"
                  onClick={() => {
                    setSelectedKey(null)
                    setDraft({ roomKey: null, points: [], active: null, original: [] })
                  }}
                  icon={
                    <>
                      <path d="M5 6.5 18.5 5l1.5 12.5L6.5 19z" />
                      <circle cx="5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
                      <circle cx="18.5" cy="5" r="1.5" fill="currentColor" stroke="none" />
                      <circle cx="20" cy="17.5" r="1.5" fill="currentColor" stroke="none" />
                      <circle cx="6.5" cy="19" r="1.5" fill="currentColor" stroke="none" />
                    </>
                  }
                />
                <ToolButton
                  label={freeOnly ? 'Show every room' : 'Show only free rooms'}
                  hint="Dim the rooms that already have a class this hour"
                  align="center"
                  pressed={freeOnly}
                  onClick={() => setFreeOnly((v) => !v)}
                  icon={
                    <>
                      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
                      <path d="M8 12.4l2.6 2.6L16.5 9" />
                    </>
                  }
                />
                <ToolButton
                  label={listMode ? 'Back to the map' : 'List this hour'}
                  hint="Every room and its class as a table, for printing"
                  align="right"
                  pressed={listMode}
                  onClick={() => setListMode((v) => !v)}
                  icon={
                    <>
                      <path d="M8 6.5h12M8 12h12M8 17.5h12" />
                      <circle cx="4.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
                      <circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
                      <circle cx="4.5" cy="17.5" r="1.2" fill="currentColor" stroke="none" />
                    </>
                  }
                />
              </div>

              {/* The colour key, and the one control that belongs with it: what
                  the grey rooms are and how to stop looking at them. */}
              {statuses.length > 0 && (
                <div className="mt-2 space-y-0.5 border-t border-neutral-200 pt-1.5">
                  {statuses.map((key) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1"
                        style={{ background: ROOM_STATUS[key].swatch, color: ROOM_STATUS[key].stroke }}
                      />
                      <Clamped className="text-[11px] text-neutral-700">
                        {ROOM_STATUS[key].label}
                      </Clamped>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setHideClosed((v) => !v)}
                    aria-pressed={hideClosed}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-[11px] text-neutral-700 hover:border-neutral-900"
                  >
                    {hideClosed ? 'Show rooms not for classes' : 'Hide rooms not for classes'}
                  </button>
                </div>
              )}

              {/* Organizations second: the fill answers "is this room free", the
                  label's colour answers "whose class is it". */}
              {legend.length > 0 && (
                <div className="mt-1.5 space-y-0.5 border-t border-neutral-200 pt-1.5">
                  {legend.map((key) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: orgInk(key) }}
                      />
                      <Clamped className="text-[11px] text-neutral-700">{orgLabel(key)}</Clamped>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] leading-snug text-red-800"
            >
              {error}
            </p>
          )}
        </div>

        <div className="pointer-events-auto flex flex-wrap justify-end gap-1.5 text-xs">
          {[
            { label: '−', title: 'Zoom out', run: () => canvas.current?.zoomBy(0.8) },
            { label: '+', title: 'Zoom in', run: () => canvas.current?.zoomBy(1.25) },
            { label: 'Fit', title: 'Fit the whole building', run: () => canvas.current?.fit() },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              title={b.title}
              onClick={b.run}
              className="min-h-9 min-w-9 rounded-md border border-neutral-300 bg-white px-2 py-1.5 font-medium text-neutral-700 shadow-sm hover:border-neutral-900"
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* The question somebody actually arrives with. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <p className="pointer-events-auto inline-block rounded-md bg-white/90 px-2 py-1 text-[11px] text-neutral-600 shadow-sm">
          {slotId
            ? `${free.length} of ${usable.length} rooms free this hour`
            : 'Pick an hour to see the schedule'}
        </p>
      </div>

      {listMode && (
        <HourList
          slot={data.slots.find((s) => s.id === slotId) ?? null}
          rooms={data.rooms}
          byRoom={byRoom}
          availability={availability}
          slotId={slotId}
          freeOnly={freeOnly}
          hideClosed={hideClosed}
          onPick={(key) => {
            setListMode(false)
            setSelectedKey(key)
          }}
          onClose={() => setListMode(false)}
        />
      )}

      {room && !draft && (
        <RoomPanel
          room={room}
          slots={data.slots}
          assignments={data.assignments.filter((a) => a.room_key === room.key)}
          classOptions={data.classOptions}
          taken={taken}
          busy={busy}
          warnings={warnings}
          onClose={() => setSelectedKey(null)}
          onRename={(name) => send(`/api/building/rooms/${room.key}`, 'PATCH', { name })}
          onToggleAssignable={(next) =>
            send(`/api/building/rooms/${room.key}`, 'PATCH', { is_assignable: next })
          }
          availability={availability}
          onSetSlotAvailability={(slot, next) =>
            send(`/api/building/rooms/${room.key}/availability`, 'PUT', {
              slot_id: slot,
              is_available: next,
            })
          }
          onReshape={() => startReshape(room.key)}
          onZoomTo={() => canvas.current?.fitTo(room.points as Pt[])}
          onDeleteRoom={() => void deleteRoom(room.key, room.name)}
          onAddAssignment={(slot, d) =>
            send('/api/building/assignments', 'POST', {
              room_key: room.key,
              slot_id: slot,
              ...d,
            })
          }
          onEditAssignment={(id, d) => send(`/api/building/assignments/${id}`, 'PATCH', d)}
          onDeleteAssignment={(id) => send(`/api/building/assignments/${id}`, 'DELETE')}
        />
      )}
    </div>
  )
}

/**
 * The hour as a table.
 *
 * This is what prints, and it is what works in a hallway on a phone where a
 * floorplan zoomed far enough to read is a floorplan you cannot navigate.
 */
function HourList({
  slot,
  rooms,
  byRoom,
  availability,
  slotId,
  freeOnly,
  hideClosed,
  onPick,
  onClose,
}: {
  slot: MeetingSlot | null
  rooms: BuildingData['rooms']
  byRoom: Map<string, RoomAssignment[]>
  availability: Map<string, boolean>
  slotId: string | null
  freeOnly: boolean
  hideClosed: boolean
  onPick: (key: string) => void
  onClose: () => void
}) {
  // The hallways never appear here — a printed sheet of what is meeting where
  // has no line for a corridor. A room that holds classes but is closed this
  // hour does appear, saying so, because "why is 101 not on the list" is a
  // worse question than one extra row; the Hide button takes it away.
  const shown = rooms
    .filter((r) => r.is_assignable)
    .map((r) => ({ room: r, status: roomStatus(r, slotId, availability, byRoom.get(r.key)?.length ?? 0) }))
    .filter(({ status }) => !hideClosed || status !== 'closed')
    .filter(({ status }) => !freeOnly || status === 'free')

  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-white/97 px-4 py-3">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-neutral-900">
            {slot ? slotLabel(slot) : 'No hour selected'}
            {freeOnly && ' · free rooms'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-md border border-neutral-300 px-2.5 text-xs text-neutral-800 ${TAP}`}
          >
            Back to the map
          </button>
        </div>

        <table className="mt-3 w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-neutral-300 text-[11px] tracking-[0.06em] text-neutral-500 uppercase">
              <th className="py-1.5 pr-3 font-medium">Room</th>
              <th className="py-1.5 font-medium">Class</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ room, status }) => {
              const here = byRoom.get(room.key) ?? []
              return (
                <tr
                  key={room.key}
                  onClick={() => onPick(room.key)}
                  className="cursor-pointer border-b border-neutral-200 hover:bg-neutral-50"
                >
                  <td className="py-1.5 pr-3 align-top font-medium text-neutral-900">
                    <span className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-sm print:hidden"
                        style={{ background: ROOM_STATUS[status].swatch }}
                      />
                      {room.name}
                    </span>
                  </td>
                  <td className="py-1.5 align-top text-neutral-700">
                    {here.length > 0 ? (
                      here.map((a) => a.title).join(', ')
                    ) : status === 'closed' ? (
                      <span className="text-neutral-500">Not available this hour</span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="mt-3 text-[12px] text-neutral-500">Nothing to list.</p>
        )}
      </div>
    </div>
  )
}
