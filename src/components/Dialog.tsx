'use client'

import { useEffect, useRef, useState } from 'react'
import { btnDanger, btnPrimary, btnQuiet, field, labelCls } from './form-styles'

/**
 * The app's own confirm, prompt and notice.
 *
 * `window.confirm` and `window.prompt` were doing this job on the building map,
 * and they are wrong here for reasons that are not cosmetic: on iOS the sheet
 * says the site's hostname above the question, a prompt cannot say what a valid
 * answer looks like, both block the main thread so the map underneath stops
 * repainting, and a browser that has had "prevent additional dialogs" ticked
 * silently returns null — which read as "cancel" and made a delete look like it
 * had simply not worked.
 *
 * One component for all three because they differ only in what is between the
 * question and the buttons: nothing, a field, or a paragraph.
 */
export type DialogRequest = {
  title: string
  /** The sentence under the title. Not the place for the question itself. */
  body?: React.ReactNode
  /** Present for a prompt; absent for a confirm or a notice. */
  input?: {
    label: string
    placeholder?: string
    initial?: string
    /** Blocks the confirm button while it returns a reason. */
    validate?: (value: string) => string | null
  }
  /** Absent for a notice, which gets a Close button and nothing else. */
  confirm?: {
    label: string
    danger?: boolean
    /** The field's value, trimmed; '' when there is no field. */
    run: (value: string) => void
  }
  cancelLabel?: string
}

export default function Dialog({
  request,
  busy = false,
  onClose,
}: {
  request: DialogRequest
  busy?: boolean
  onClose: () => void
}) {
  const [value, setValue] = useState(request.input?.initial ?? '')
  const [touched, setTouched] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  /** What had focus before this opened, so closing puts it back. */
  const restore = useRef<Element | null>(null)

  const trimmed = value.trim()
  const problem = request.input?.validate?.(trimmed) ?? null
  const blocked = Boolean(problem) || (Boolean(request.input) && trimmed.length === 0)

  useEffect(() => {
    restore.current = document.activeElement
    // The field if there is one, the confirm button otherwise: opening a delete
    // confirmation with the destructive button focused is what makes Enter
    // confirm, and it is also what a screen reader reads out first.
    ;(input.current ?? confirmButton.current)?.focus()
    return () => {
      if (restore.current instanceof HTMLElement) restore.current.focus()
    }
  }, [])

  /**
   * Escape closes, and the listener is captured so the map's own Escape
   * handling — which unwinds a trace, then a selection — never fires from
   * underneath an open dialog.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  function submit() {
    if (busy || blocked || !request.confirm) return
    request.confirm.run(trimmed)
  }

  return (
    <div
      className="absolute inset-0 z-40 flex items-end justify-center bg-black/40 p-3 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      // A tap on the backdrop is a cancel, but only a tap that started there:
      // dragging out of the card while selecting text must not close it.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl">
        <h2 id="dialog-title" className="text-sm font-semibold text-neutral-900">
          {request.title}
        </h2>

        {request.body && (
          <p className="mt-2 text-[13px] leading-relaxed text-neutral-600">{request.body}</p>
        )}

        {request.input && (
          <label className="mt-3 block">
            <span className={labelCls}>{request.input.label}</span>
            <input
              ref={input}
              type="text"
              value={value}
              placeholder={request.input.placeholder}
              disabled={busy}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => setTouched(true)}
              // Enter is how a one-field form is submitted everywhere else.
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
              className={field}
            />
            {/* Only after the field has been left: telling somebody their answer
                is too short before they have typed the second character is noise. */}
            {problem && touched && (
              <span className="mt-1 block text-[11px] text-red-700">{problem}</span>
            )}
          </label>
        )}

        {/* Confirm first on a phone, where the thumb is at the bottom of the
            screen and the last row is the one it reaches. */}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={busy} onClick={onClose} className={btnQuiet}>
            {request.cancelLabel ?? (request.confirm ? 'Cancel' : 'Close')}
          </button>
          {request.confirm && (
            <button
              ref={confirmButton}
              type="button"
              disabled={busy || blocked}
              onClick={submit}
              className={request.confirm.danger ? btnDanger : btnPrimary}
            >
              {busy ? 'Working…' : request.confirm.label}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
