/**
 * Moved to src/lib/address.ts when the app itself started needing it — the PDF
 * importers run inside a route handler and match the same addresses these
 * scripts do. Re-exported here so the import scripts keep their short paths.
 */
export * from '../../src/lib/address'
