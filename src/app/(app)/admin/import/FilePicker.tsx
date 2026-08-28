/**
 * The file chooser each importer puts above its preview button.
 *
 * A bare `<input type="file">` renders as unstyled browser chrome — a grey
 * button glued to 'No file chosen' — which reads as text rather than a control
 * and cannot be made to match the rest of the page. So the real input is kept
 * (it is what opens the picker and what screen readers announce) and hidden,
 * with a label drawn as the button and the chosen name printed beside it.
 */
export default function FilePicker({
  file,
  onPick,
}: {
  file: File | null
  onPick: (file: File | null) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="cursor-pointer rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-neutral-900 has-[:focus-visible]:ring-offset-2">
        {file ? 'Choose a different PDF' : 'Choose PDF'}
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => {
            onPick(e.target.files?.[0] ?? null)
            // Clearing the input lets the same file be picked again after a
            // failed read — otherwise re-selecting it fires no change event.
            e.target.value = ''
          }}
        />
      </label>
      {file && (
        <span className="max-w-xs truncate text-sm text-neutral-600" title={file.name}>
          {file.name}
        </span>
      )}
    </div>
  )
}
