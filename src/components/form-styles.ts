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

/**
 * A button that can be hit with a thumb: 44px on touch, 36px once there is a
 * pointer. `TAP` above only sets a floor and leaves everything else to the call
 * site, which is how the building map ended up with a 20px "Add a class" — these
 * carry the padding and the type size too, so a button is the right size by
 * default rather than by remembering.
 */
const BTN_BASE =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium ' +
  'disabled:opacity-40 sm:min-h-9 sm:text-[13px]'

/** The one action a card is for. */
export const btnPrimary = `${BTN_BASE} bg-blue-600 text-white hover:bg-blue-700`
/** Everything alongside it. */
export const btnQuiet = `${BTN_BASE} border border-neutral-300 bg-white text-neutral-800 hover:border-neutral-900`
/** Destructive, and never the default. */
export const btnDanger = `${BTN_BASE} border border-red-300 bg-white text-red-700 hover:border-red-600`
/** Smaller, for the row of controls on a single list item. */
export const btnSmall =
  'inline-flex min-h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-2.5 text-xs text-neutral-700 hover:border-neutral-900 disabled:opacity-40'

/**
 * A checkbox and its label as one 44px row, so the label is part of the target
 * rather than a 16px box being the whole of it.
 */
export const checkRow =
  'flex min-h-11 items-center gap-2 text-[13px] text-neutral-700 sm:min-h-9'
export const checkBox = 'h-5 w-5 shrink-0 accent-blue-600 sm:h-4 sm:w-4'
