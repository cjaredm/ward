import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sql } from '@/lib/db'
import { authErrorResponse, requireSectionEdit } from '@/lib/auth'

export const runtime = 'nodejs'

const Body = z.object({
  slot_id: z.string().uuid(),
  /**
   * True or false stores an override; null removes it, so the room goes back to
   * following its own `is_assignable`. Three states, one field — the same
   * absent/null/value shape the room's label anchor uses.
   */
  is_available: z.boolean().nullable(),
})

/**
 * Opens or closes one room for one hour.
 *
 * A PUT rather than a POST: the body names the room and the hour, and sending it
 * twice has to leave one row, not two. The unique key is (room, hour), so this is
 * an upsert and the double tap is harmless by construction.
 *
 * Requires the section rather than an admin, matching assignments: deciding the
 * chapel is unavailable first hour is the same kind of decision as putting a
 * class in it, and it is undone by ticking the box back.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ roomKey: string }> }) {
  let actor: string
  try {
    actor = (await requireSectionEdit('building')).name
  } catch (err) {
    return authErrorResponse(err)
  }

  const { roomKey } = await ctx.params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid change', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { slot_id, is_available } = parsed.data

  const room = (await sql`
    SELECT key, name, is_assignable FROM building_rooms WHERE key = ${roomKey}
  `) as { key: string; name: string; is_assignable: boolean }[]
  if (room.length === 0) return NextResponse.json({ error: 'No such room' }, { status: 404 })

  const slot = (await sql`
    SELECT id FROM meeting_slots WHERE id = ${slot_id}::uuid
  `) as { id: string }[]
  if (slot.length === 0) return NextResponse.json({ error: 'No such hour' }, { status: 404 })

  // Closing a room that already has a class in it would leave the map painting a
  // class in a room it also says is unavailable. Refused with the count, the same
  // stance deleting a room and deleting an hour take — clear it deliberately.
  if (is_available === false || (is_available === null && !room[0].is_assignable)) {
    const held = (await sql`
      SELECT count(*)::int AS n FROM room_assignments
      WHERE room_key = ${roomKey} AND slot_id = ${slot_id}::uuid
    `) as { n: number }[]
    if (held[0].n > 0) {
      return NextResponse.json(
        {
          error: `${room[0].name} still has ${held[0].n} class${
            held[0].n === 1 ? '' : 'es'
          } this hour. Remove them before closing the room.`,
        },
        { status: 409 },
      )
    }
  }

  if (is_available === null) {
    await sql`
      DELETE FROM room_slot_availability
      WHERE room_key = ${roomKey} AND slot_id = ${slot_id}::uuid
    `
  } else {
    await sql`
      INSERT INTO room_slot_availability (room_key, slot_id, is_available, updated_by)
      VALUES (${roomKey}, ${slot_id}::uuid, ${is_available}, ${actor})
      ON CONFLICT (room_key, slot_id) DO UPDATE SET
        is_available = excluded.is_available,
        updated_at   = now(),
        updated_by   = excluded.updated_by
    `
  }

  await sql`
    INSERT INTO audit_log (actor, action, entity_id, diff)
    VALUES (${actor}, 'set_room_availability', ${roomKey},
            ${JSON.stringify({ slot_id, is_available })})
  `

  return NextResponse.json({ ok: true })
}
