'use client'

import { useEffect, useRef, useState } from 'react'
import SignInForm from './SignInForm'

/**
 * The Sign in button on the public landing page, and the dialog it opens.
 *
 * A dialog rather than a link to /login so a member arriving at the public page
 * is one tap from the ward tools without losing the page they were reading.
 * /login still exists and still works: it is where middleware sends an expired
 * session, and where a bookmark or a shared link lands.
 *
 * `fixed`, not `absolute` like Dialog.tsx — that one lives inside the map's own
 * positioned container, this one covers the document.
 */
export default function SignInDialog({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)

  // Escape closes, and focus goes back to the button that opened it rather than
  // to the top of the document.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function close() {
    setOpen(false)
    button.current?.focus()
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          'inline-flex min-h-11 shrink-0 items-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white transition hover:bg-neutral-700 sm:min-h-9'
        }
      >
        Sign in
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="signin-title"
          // A tap on the backdrop is a cancel, but only one that started there:
          // dragging out of the card while selecting text must not close it.
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) close()
          }}
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="signin-title" className="text-base font-semibold text-neutral-900">
                  Sign in
                </h2>
                <p className="mt-1 text-[13px] text-neutral-600">
                  Ward tools are for members with a calling that needs them.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="-m-2 shrink-0 rounded-md p-2 text-neutral-500 hover:text-neutral-900"
              >
                <span aria-hidden>✕</span>
              </button>
            </div>

            <div className="mt-4">
              <SignInForm autoFocus />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
