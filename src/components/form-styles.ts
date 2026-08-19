/**
 * The form styles shared by everything that edits a household — the map panel
 * and the member list. Kept in one place so a field typed on a phone in a
 * parking lot behaves the same wherever it is rendered.
 */

/** 16px on a phone: anything smaller is hard to read at arm's length outdoors. */
export const field =
  'mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-2.5 text-base text-neutral-900 outline-none focus:border-neutral-900 sm:py-2 sm:text-sm'

export const labelCls = 'block text-xs font-medium text-neutral-700'

/** 44px minimum hit area on touch, compact again at `sm`. */
export const TAP = 'min-h-11 sm:min-h-0'
