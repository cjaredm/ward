/**
 * Writes a minimal one-font PDF with text at exact coordinates.
 *
 * Only exists so the callings parser can be tested against a real PDF — the
 * column-split path needs x coordinates, which a text fixture cannot carry, and
 * the parser's primary path is the one that should be under test.
 *
 * Not a general PDF writer: uncompressed streams, Helvetica, one page size.
 */
export type PdfRun = { text: string; x: number; y: number; size?: number }

const HEADER = '%PDF-1.4\n'

function escapeText(value: string): string {
  return value.replace(/([\\()])/g, '\\$1')
}

function contentStream(runs: PdfRun[]): string {
  return runs
    .map(
      (r) =>
        `BT /F1 ${r.size ?? 9} Tf 1 0 0 1 ${r.x.toFixed(2)} ${r.y.toFixed(2)} Tm (${escapeText(r.text)}) Tj ET`,
    )
    .join('\n')
}

export function makePdf(pages: PdfRun[][], width = 612, height = 792): Uint8Array {
  const objects: string[] = []
  const pageIds = pages.map((_, i) => 4 + i * 2)

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'

  pages.forEach((runs, i) => {
    const pageId = pageIds[i]
    const contentId = pageId + 1
    const stream = contentStream(runs)
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })

  // Serialize in object-number order, recording byte offsets for the xref table.
  let body = HEADER
  const offsets: number[] = []
  for (let n = 1; n < objects.length; n++) {
    if (!objects[n]) continue
    offsets[n] = body.length
    body += `${n} 0 obj\n${objects[n]}\nendobj\n`
  }

  const xrefAt = body.length
  const maxObj = objects.length
  let xref = `xref\n0 ${maxObj}\n0000000000 65535 f \n`
  for (let n = 1; n < maxObj; n++) {
    xref += offsets[n]
      ? `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
      : `0000000000 65535 f \n`
  }

  const trailer = `trailer\n<< /Size ${maxObj} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return new TextEncoder().encode(body + xref + trailer)
}
