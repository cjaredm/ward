/**
 * Entry-point wrapper for scripts/.
 *
 * The package is CommonJS, so top-level await is unavailable; this also gives
 * every script a non-zero exit code and a readable one-line error instead of a
 * raw rejection stack.
 */
export function run(main: () => Promise<void>): void {
  main().catch((err: unknown) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`)
    if (err instanceof Error && err.stack && process.env.DEBUG) console.error(err.stack)
    process.exit(1)
  })
}
